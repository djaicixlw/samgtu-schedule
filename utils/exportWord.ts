import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, AlignmentType, WidthType, VerticalAlign, UnderlineType, PageOrientation } from 'docx';
import { AttendanceRecord, BLOCKS } from '../attendance';
import { Student, GroupConfig, Faculty } from '../types';
import { WORKER_BASE } from './cloudSync';

export interface ExportWordResult {
  success: boolean;
  sentToTelegramChat: boolean;
  downloadUrl?: string;
  method: 'tma_download_file' | 'tma_open_link' | 'web_share' | 'browser_blob';
}

/**
 * Generates an official SamGTU Dean's Office attendance report in Microsoft Word (.docx) format
 * and delivers the resulting document using a robust fallback cascade:
 *
 * - **Tier 1: TMA Cloud Gateway (/export-doc -> Telegram Bot API)**
 *   When running inside Telegram Mini Apps (Android WebView / iOS / Desktop):
 *   1) Securely validates session via X-Telegram-Init-Data (using tg.initDataUnsafe?.user?.id).
 *   2) Sends the document to the Cloudflare Worker `/export-doc` endpoint.
 *   3) Opens the file via native Telegram download dialog (`tg.downloadFile` for Bot API 8.0+) or fallback browser tab (`tg.openLink`).
 *
 * - **Tier 2: Mobile Web Share API (Mobile Safari / Chrome)**
 *   If running in mobile browsers with `navigator.canShare({ files })` support, opens the system share dialog.
 *
 * - **Tier 3: HTML5 Blob Anchor Download (Desktop Web Fallback)**
 *   Generates an object URL (`URL.createObjectURL`) and triggers an invisible `<a download>` click with automatic DOM cleanup.
 *
 * @param records Student attendance records for the semester
 * @param students List of students in the group (names and identifiers)
 * @param groupConfig Configuration and naming metadata of the target group
 * @param faculty Faculty / Institute descriptor
 * @returns Metadata object detailing execution result and delivery method
 */
export const exportAttendanceToWord = async (
  records: AttendanceRecord[],
  students: Student[],
  groupConfig: GroupConfig,
  faculty: Faculty
): Promise<ExportWordResult> => {
  const tableRows: TableRow[] = [];

  // Header Row 1
  tableRows.push(
    new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: "№ п/п", bold: true })], alignment: AlignmentType.CENTER })],
          rowSpan: 2,
          verticalAlign: VerticalAlign.CENTER,
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: "ФИО обучающегося", bold: true })], alignment: AlignmentType.CENTER })],
          rowSpan: 2,
          verticalAlign: VerticalAlign.CENTER,
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: "Курс", bold: true })], alignment: AlignmentType.CENTER })],
          rowSpan: 2,
          verticalAlign: VerticalAlign.CENTER,
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: "Группа", bold: true })], alignment: AlignmentType.CENTER })],
          rowSpan: 2,
          verticalAlign: VerticalAlign.CENTER,
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: "Количество пропущенных часов", bold: true })], alignment: AlignmentType.CENTER })],
          columnSpan: BLOCKS.length,
          verticalAlign: VerticalAlign.CENTER,
        }),
      ],
    })
  );

  // Header Row 2
  tableRows.push(
    new TableRow({
      children: BLOCKS.map(block => {
        const [year, month, day] = block.end.split('-');
        return new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: `на ${day}.${month}.${year} г.`, bold: true })], alignment: AlignmentType.CENTER })],
          verticalAlign: VerticalAlign.CENTER,
        });
      }),
    })
  );

  // Data Rows
  const today = new Date().toISOString().split('T')[0];

  students.forEach((student, index) => {
    let cumulativeAbsences = 0;
    let cumulativeExcused = 0;
    
    const blockCells = BLOCKS.map(block => {
      let blockAbsences = 0;
      let blockExcused = 0;
      
      records.forEach(record => {
        if (record.isCancelled) return;
        if (record.date >= block.start && record.date <= block.end) {
          const isExcused = (record.excusedStudentIds || []).includes(student.id);
          const isAbsent = !isExcused && record.absentStudentIds.includes(student.id);
          if (isExcused) blockExcused += 2;
          else if (isAbsent) blockAbsences += 2;
        }
      });
      
      cumulativeAbsences += blockAbsences;
      cumulativeExcused += blockExcused;
      
      const parts = [];
      if (blockAbsences > 0) parts.push(`${blockAbsences} Не УП`);
      if (blockExcused > 0) parts.push(`${blockExcused} УП`);
      const cellText = parts.length > 0 ? parts.join(', ') : '0';

      return new TableCell({
        children: [new Paragraph({ text: cellText, alignment: AlignmentType.CENTER })],
        verticalAlign: VerticalAlign.CENTER,
      });
    });

    const groupName = groupConfig.name || '3-ИНГТ-110';

    tableRows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ text: (index + 1).toString(), alignment: AlignmentType.CENTER })],
            verticalAlign: VerticalAlign.CENTER,
          }),
          new TableCell({
            children: [new Paragraph({ text: student.name })],
            verticalAlign: VerticalAlign.CENTER,
          }),
          new TableCell({
            children: [new Paragraph({ text: (groupConfig.course || 3).toString(), alignment: AlignmentType.CENTER })],
            verticalAlign: VerticalAlign.CENTER,
          }),
          new TableCell({
            children: [new Paragraph({ text: groupName, alignment: AlignmentType.CENTER })],
            verticalAlign: VerticalAlign.CENTER,
          }),
          ...blockCells,
        ],
      })
    );
  });

  const table = new Table({
    rows: tableRows,
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
            },
            margin: {
              top: 1000,
              right: 1000,
              bottom: 1000,
              left: 1000,
            },
          },
        },
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "Сведение",
                bold: true,
                size: 24, // 12pt
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "Количество пропусков занятий без уважительных причин в осеннем семестре 2026-2027 уч.г.",
                bold: true,
                size: 24, // 12pt
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: faculty?.name || "Институт нефтегазовых технологий",
                bold: true,
                size: 24,
                underline: {
                  type: UnderlineType.SINGLE,
                  color: "000000"
                }
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "(наименование структурного подразделения)",
                italics: true,
                size: 20, // 10pt
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: {
              after: 400,
            },
          }),
          table,
        ],
      },
    ],
  });

  const filename = `Пропуски_${groupConfig.name || '3-ИНГТ-110'}.docx`;
  const blob = await Packer.toBlob(doc);

  // Tier 1: Telegram Mini App Cloud Gateway (TMA Android WebView / iOS / Desktop)
  const tg = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : null;
  const isTMA = Boolean(tg && (tg.initData || tg.initDataUnsafe?.user?.id || tg.initDataUnsafe?.user));

  if (isTMA) {
    try {
      const formData = new FormData();
      formData.append('document', blob, filename);
      formData.append('filename', filename);
      formData.append(
        'caption',
        `📄 Официальная ведомость пропусков (${groupConfig.name || 'СамГТУ'})\n📅 Сформировано: ${new Date().toLocaleDateString('ru-RU')}`
      );

      let directUrl: string | null = null;
      let sentToPm = false;

      const headers: Record<string, string> = {
        ...(tg?.initData ? { 'X-Telegram-Init-Data': tg.initData } : {})
      };

      // Primary: Try dedicated /export-doc endpoint
      try {
        const uploadRes = await fetch(`${WORKER_BASE}/export-doc`, {
          method: 'POST',
          headers,
          body: formData
        });

        if (uploadRes.ok) {
          const contentType = uploadRes.headers && typeof (uploadRes.headers as any).get === 'function'
            ? uploadRes.headers.get('content-type') || ''
            : (uploadRes.headers && (uploadRes.headers as any)['content-type']) || '';
          if (contentType.includes('application/json')) {
            const data = await uploadRes.json();
            if (data.ok && data.direct_url) {
              directUrl = data.direct_url;
              sentToPm = Boolean(data.sent_to_pm);
            }
          }
        }
      } catch (docErr) {
        console.warn('/export-doc probe failed, trying live upload fallback:', docErr);
      }

      // Live worker fallback: If /export-doc is not active on live worker, use live /upload
      if (!directUrl) {
        try {
          const uploadRes = await fetch(`${WORKER_BASE}/upload`, {
            method: 'POST',
            headers,
            body: formData
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            const fileId = uploadData.result?.document?.file_id;
            if (fileId) {
              directUrl = `${WORKER_BASE}/file?file_id=${fileId}&download=1&filename=${encodeURIComponent(filename)}`;
            }
          }
        } catch (uploadErr) {
          console.warn('/upload fallback failed:', uploadErr);
        }
      }

      if (directUrl) {
        // 2.A. Telegram Bot API >= 8.0: Native Telegram download dialog
        if (typeof tg.downloadFile === 'function' && (typeof tg.isVersionAtLeast === 'function' ? tg.isVersionAtLeast('8.0') : true)) {
          tg.downloadFile({ url: directUrl, file_name: filename }, (accepted: boolean) => {
            if (!accepted && typeof tg.openLink === 'function') {
              tg.openLink(directUrl);
            }
          });
          return { success: true, sentToTelegramChat: sentToPm, downloadUrl: directUrl, method: 'tma_download_file' };
        }

        // 2.B. Telegram < 8.0: Open HTTPS URL in native phone browser (Chrome/Safari)
        if (typeof tg.openLink === 'function') {
          tg.openLink(directUrl);
          return { success: true, sentToTelegramChat: sentToPm, downloadUrl: directUrl, method: 'tma_open_link' };
        }
      }
    } catch (tmaError) {
      console.warn('Tier 1 (TMA) cloud gateway failed, falling back to Tier 2 (Web Share):', tmaError);
    }
  }

  // Tier 2: Mobile Web Share API (Safari / Chrome Mobile)
  if (typeof navigator !== 'undefined' && typeof File !== 'undefined' && typeof navigator.canShare === 'function') {
    try {
      const file = new File([blob], filename, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename,
          text: `Ведомость посещаемости (${groupConfig.name || 'СамГТУ'})`
        });
        return { success: true, sentToTelegramChat: false, method: 'web_share' };
      }
    } catch (shareError: any) {
      // If user simply closed the share sheet, do not throw
      if (shareError?.name === 'AbortError') {
        return { success: true, sentToTelegramChat: false, method: 'web_share' };
      }
      console.warn('Tier 2 (Web Share) failed, falling back to Tier 3 (Blob Anchor):', shareError);
    }
  }

  // Tier 3: HTML5 Blob Anchor Download (Desktop / Web Fallback)
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof window.URL?.createObjectURL === 'function') {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    document.body.appendChild(a);
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => {
      try {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } catch (e) {}
    }, 3000);

    return { success: true, sentToTelegramChat: false, method: 'browser_blob' };
  }

  return { success: true, sentToTelegramChat: false, method: 'browser_blob' };
};
