import fs from 'fs';

const filePath = 'constants.ts';
let content = fs.readFileSync(filePath, 'utf-8');

const FAID_TEACHERS: Record<string, string> = {
  'Безопасность жизнедеятельности': 'Закирова Марина Николаевна',
  'История дизайна науки и техники': 'Каракова Татьяна Владимировна',
  'Специальный рисунок и живопись': 'Каракова Татьяна Владимировна',
  'Вертикальная планировка и благоустройство территорий': 'Орлова Наталья Александровна',
  'Архитектурно–дизайнерское материаловедение': 'Тюрников Владимир Викторович',
  'Компьютерные технологии в проектировании': 'Евстратова Елена Александровна',
  'Философия': 'Стоцкая Татьяна Геннадьевна',
  'Конструирование в дизайне среды': 'Заславский Евгений Михайлович',
  'Проектирование': 'Смоленская Елена Олеговна',
  'Практико-ориентированный проект': 'Смоленская Елена Олеговна',
  'Элективные курсы по физической культуре и спорту': 'Кафедра физического воспитания'
};

for (const [subj, teacher] of Object.entries(FAID_TEACHERS)) {
  // Regex to replace teacher: "" with teacher: "<teacher>" for that subject inside faid-310
  const pattern = new RegExp(`(subject:\\s*"${subj}",\\s*type:\\s*'[^']+',\\s*location:\\s*"[^"]*",\\s*teacher:\\s*)"(?:Кафедра[^"]*)?"`, 'g');
  content = content.replace(pattern, `$1"${teacher}"`);
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Successfully updated constants.ts with FAID teachers!');
