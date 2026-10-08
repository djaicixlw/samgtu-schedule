import { WeekData, Faculty, GroupConfig, Registry, DaySchedule } from './types';

export const FACULTIES: Faculty[] = [
  { id: 'ingt', name: 'Институт нефтегазовых технологий', shortName: 'ИНГТ' },
  { id: 'asa', name: 'Академия строительства и архитектуры', shortName: 'АСА' },
  { id: 'iait', name: 'Институт автоматики и информационных технологий', shortName: 'ИАИТ' },
  { id: 'itf', name: 'Инженерно-технологический факультет', shortName: 'ИТФ' },
  { id: 'etf', name: 'Электротехнический факультет', shortName: 'ЭТФ' },
  { id: 'htf', name: 'Химико-технологический факультет', shortName: 'ХТФ' },
  { id: 'tef', name: 'Теплоэнергетический факультет', shortName: 'ТЭФ' },
  { id: 'fmmt', name: 'Факультет машиностроения, металлургии и транспорта', shortName: 'ФММТ' },
  { id: 'fpp', name: 'Факультет пищевых производств', shortName: 'ФПП' },
  { id: 'iiego', name: 'Институт инженерно-экономического и гуманитарного образования', shortName: 'ИИЭГО' },
  { id: 'faid', name: 'Факультет архитектуры и дизайна (АСА)', shortName: 'ФАИД' }
];

export const AVAILABLE_GROUPS: GroupConfig[] = [
  // ИНГТ 3 курс (весь бакалаврский поток 101–114)
  { id: 'ingt-301', name: '3-ИНГТ-101', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-302', name: '3-ИНГТ-102', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-303', name: '3-ИНГТ-103', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-304', name: '3-ИНГТ-104', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-305', name: '3-ИНГТ-105', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-306', name: '3-ИНГТ-106', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-307', name: '3-ИНГТ-107', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-308', name: '3-ИНГТ-108', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-309', name: '3-ИНГТ-109', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-310', name: '3-ИНГТ-110', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-311', name: '3-ИНГТ-111', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-312', name: '3-ИНГТ-112', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-313', name: '3-ИНГТ-113', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },
  { id: 'ingt-314', name: '3-ИНГТ-114', facultyId: 'ingt', degree: 'Бакалавриат', course: 3 },

  // Другие факультеты и курсы с расписанием
  { id: 'faid-310', name: '3-ФАИД-110', facultyId: 'faid', degree: 'Бакалавриат', course: 3 },
  { id: 'htf-215', name: '2-ХТФ-115', facultyId: 'htf', degree: 'Бакалавриат', course: 2 },
  { id: 'iait-308', name: '3-ИАИТ-108', facultyId: 'iait', degree: 'Бакалавриат', course: 3 },
  { id: 'faid-501', name: '5-ФАИД-101', facultyId: 'faid', degree: 'Специалитет', course: 5 },

  // ИНГТ 1 курс (весь поток 101–114)
  { id: 'ingt-101', name: '1-ИНГТ-101', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-102', name: '1-ИНГТ-102', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-103', name: '1-ИНГТ-103', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-104', name: '1-ИНГТ-104', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-105', name: '1-ИНГТ-105', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-106', name: '1-ИНГТ-106', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-107', name: '1-ИНГТ-107', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-108', name: '1-ИНГТ-108', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-109', name: '1-ИНГТ-109', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-110', name: '1-ИНГТ-110', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-111', name: '1-ИНГТ-111', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-112', name: '1-ИНГТ-112', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-113', name: '1-ИНГТ-113', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },
  { id: 'ingt-114', name: '1-ИНГТ-114', facultyId: 'ingt', degree: 'Бакалавриат', course: 1 },

  // ИНГТ 2 курс (весь поток 101–114)
  { id: 'ingt-201', name: '2-ИНГТ-101', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-202', name: '2-ИНГТ-102', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-203', name: '2-ИНГТ-103', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-204', name: '2-ИНГТ-104', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-205', name: '2-ИНГТ-105', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-206', name: '2-ИНГТ-106', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-207', name: '2-ИНГТ-107', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-208', name: '2-ИНГТ-108', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-209', name: '2-ИНГТ-109', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-210', name: '2-ИНГТ-110', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-211', name: '2-ИНГТ-111', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-212', name: '2-ИНГТ-112', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-213', name: '2-ИНГТ-113', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },
  { id: 'ingt-214', name: '2-ИНГТ-114', facultyId: 'ingt', degree: 'Бакалавриат', course: 2 },

  // Старшие курсы ИНГТ
  { id: 'ingt-401', name: '4-ИНГТ-101', facultyId: 'ingt', degree: 'Бакалавриат', course: 4 },
  { id: 'ingt-501', name: '5-ИНГТ-101', facultyId: 'ingt', degree: 'Специалитет', course: 5 },

  // АСА
  { id: 'asa-101', name: '1-АСА-101', facultyId: 'asa', degree: 'Бакалавриат', course: 1 },
  { id: 'asa-201', name: '2-АСА-101', facultyId: 'asa', degree: 'Бакалавриат', course: 2 },
  { id: 'asa-301', name: '3-АСА-101', facultyId: 'asa', degree: 'Бакалавриат', course: 3 },
  { id: 'asa-401', name: '4-АСА-101', facultyId: 'asa', degree: 'Бакалавриат', course: 4 },
  { id: 'asa-501', name: '5-АСА-101', facultyId: 'asa', degree: 'Специалитет', course: 5 },

  // ИАИТ
  { id: 'iait-101', name: '1-ИАИТ-101', facultyId: 'iait', degree: 'Бакалавриат', course: 1 },
  { id: 'iait-201', name: '2-ИАИТ-101', facultyId: 'iait', degree: 'Бакалавриат', course: 2 },
  { id: 'iait-301', name: '3-ИАИТ-101', facultyId: 'iait', degree: 'Бакалавриат', course: 3 },
  { id: 'iait-401', name: '4-ИАИТ-101', facultyId: 'iait', degree: 'Бакалавриат', course: 4 },

  // ИТФ
  { id: 'itf-101', name: '1-ИТФ-101', facultyId: 'itf', degree: 'Бакалавриат', course: 1 },
  { id: 'itf-201', name: '2-ИТФ-101', facultyId: 'itf', degree: 'Бакалавриат', course: 2 },
  { id: 'itf-301', name: '3-ИТФ-101', facultyId: 'itf', degree: 'Бакалавриат', course: 3 },
  { id: 'itf-501', name: '5-ИТФ-101', facultyId: 'itf', degree: 'Специалитет', course: 5 },

  // ЭТФ
  { id: 'etf-101', name: '1-ЭТФ-101', facultyId: 'etf', degree: 'Бакалавриат', course: 1 },
  { id: 'etf-201', name: '2-ЭТФ-101', facultyId: 'etf', degree: 'Бакалавриат', course: 2 },
  { id: 'etf-301', name: '3-ЭТФ-101', facultyId: 'etf', degree: 'Бакалавриат', course: 3 },

  // ХТФ
  { id: 'htf-101', name: '1-ХТФ-101', facultyId: 'htf', degree: 'Бакалавриат', course: 1 },
  { id: 'htf-201', name: '2-ХТФ-101', facultyId: 'htf', degree: 'Бакалавриат', course: 2 },
  { id: 'htf-301', name: '3-ХТФ-101', facultyId: 'htf', degree: 'Бакалавриат', course: 3 },

  // ТЭФ
  { id: 'tef-101', name: '1-ТЭФ-101', facultyId: 'tef', degree: 'Бакалавриат', course: 1 },
  { id: 'tef-301', name: '3-ТЭФ-101', facultyId: 'tef', degree: 'Бакалавриат', course: 3 },

  // ФММТ
  { id: 'fmmt-101', name: '1-ФММТ-101', facultyId: 'fmmt', degree: 'Бакалавриат', course: 1 },
  { id: 'fmmt-301', name: '3-ФММТ-101', facultyId: 'fmmt', degree: 'Бакалавриат', course: 3 },

  // ФПП
  { id: 'fpp-101', name: '1-ФПП-101', facultyId: 'fpp', degree: 'Бакалавриат', course: 1 },
  { id: 'fpp-301', name: '3-ФПП-101', facultyId: 'fpp', degree: 'Бакалавриат', course: 3 },

  // ИИЭГО
  { id: 'iiego-101', name: '1-ИИЭГО-101', facultyId: 'iiego', degree: 'Бакалавриат', course: 1 },
  { id: 'iiego-301', name: '3-ИИЭГО-101', facultyId: 'iiego', degree: 'Бакалавриат', course: 3 }
];

export const SCHEDULE_REGISTRY: Registry<WeekData> = {

  'ingt-310': {
    1: [
      {
        dayName: 'Понедельник',
        lessons: [
          { id: '310-w1-mo-1', timeStart: '11:50', timeEnd: '13:25', subject: "Элективные курсы по физической культуре и спорту", type: 'Практические занятия', location: "Спортивный комплекс", teacher: "Кафедра физического воспитания" },
          { id: '310-w1-mo-2', timeStart: '13:35', timeEnd: '15:10', subject: "Конструирование и расчет сосудов и аппаратов нефтегазовых промыслов, работающих под давлением", type: 'Лабораторные работы', location: "Корпус № 9, 423", teacher: "Крючков Дмитрий Александрович" },
          { id: '310-w1-mo-3', timeStart: '15:40', timeEnd: '17:15', subject: "Конструирование и расчет сосудов и аппаратов нефтегазовых промыслов, работающих под давлением", type: 'Лабораторные работы', location: "Корпус № 9, 423", teacher: "Крючков Дмитрий Александрович" },
          { id: '310-w1-mo-4', timeStart: '17:25', timeEnd: '19:00', subject: "Безопасность жизнедеятельности", type: 'Лекции', location: "Корпус № 1, 432", teacher: "Сорокина Людмила Владимировна" }
        ]
      },
      {
        dayName: 'Вторник',
        lessons: [
          { id: '310-w1-tu-1', timeStart: '08:00', timeEnd: '09:35', subject: "Технологии ресурсоповышающей обработки", type: 'Практические занятия', location: "Корпус № 1, 109", teacher: "Ибатуллин Ильдар Дугласович" },
          { id: '310-w1-tu-2', timeStart: '09:45', timeEnd: '11:20', subject: "Технологии ресурсоповышающей обработки", type: 'Лекции', location: "Корпус № 1, 4", teacher: "Ибатуллин Ильдар Дугласович" },
          { id: '310-w1-tu-3', timeStart: '11:50', timeEnd: '13:25', subject: "Конструирование и расчет сосудов и аппаратов нефтегазовых промыслов, работающих под давлением", type: 'Лекции', location: "Корпус № 9, 423", teacher: "Крючков Дмитрий Александрович" },
          { id: '310-w1-tu-4', timeStart: '13:35', timeEnd: '15:10', subject: "Конструирование и расчет сосудов и аппаратов нефтегазовых промыслов, работающих под давлением", type: 'Практические занятия', location: "Корпус № 9, 423", teacher: "Крючков Дмитрий Александрович" }
        ]
      },
      {
        dayName: 'Среда',
        lessons: [
          { id: '310-w1-we-1', timeStart: '08:00', timeEnd: '09:35', subject: "Техника и технология бурения нефтегазовых скважин", type: 'Лекции', location: "Корпус № 1, 4", teacher: "Драницына Елена Геннадьевна" },
          { id: '310-w1-we-2', timeStart: '09:45', timeEnd: '11:20', subject: "Техника и технология бурения нефтегазовых скважин", type: 'Практические занятия', location: "Корпус № 1, 4", teacher: "Драницына Елена Геннадьевна" },
          { id: '310-w1-we-3', timeStart: '11:50', timeEnd: '13:25', subject: "Компьютерное моделирование нефтегазового оборудования", type: 'Лекции', location: "Корпус № 1, 2", teacher: "Петровская Марина Владимировна" },
          { id: '310-w1-we-4', timeStart: '13:35', timeEnd: '15:10', subject: "Компьютерное моделирование нефтегазового оборудования", type: 'Практические занятия', location: "Корпус № 1, 2", teacher: "Петровская Марина Владимировна" }
        ]
      },
      {
        dayName: 'Четверг',
        lessons: [
          { id: '310-w1-th-1', timeStart: '11:50', timeEnd: '13:25', subject: "Основы военной подготовки", type: 'Практические занятия', location: "Корпус № 3, 208", teacher: "Военный учебный центр" },
          { id: '310-w1-th-2', timeStart: '13:35', timeEnd: '15:10', subject: "Основы военной подготовки", type: 'Практические занятия', location: "Корпус № 3, 208", teacher: "Военный учебный центр" }
        ]
      },
      {
        dayName: 'Пятница',
        lessons: [
          { id: '310-w1-fr-1', timeStart: '11:50', timeEnd: '13:25', subject: "Основы расчета колебаний динамического оборудования нефтяных и газовых промыслов", type: 'Лекции', location: "Корпус № 9, 409", teacher: "Коныгин Сергей Борисович" },
          { id: '310-w1-fr-2', timeStart: '13:35', timeEnd: '15:10', subject: "Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования", type: 'Лекции', location: "Корпус № 1, 109", teacher: "Парфенов Кирилл Викторович" },
          { id: '310-w1-fr-3', timeStart: '15:40', timeEnd: '17:15', subject: "Основы расчета колебаний динамического оборудования нефтяных и газовых промыслов", type: 'Практические занятия', location: "Корпус № 1, 2", teacher: "Петровская Марина Владимировна" },
          { id: '310-w1-fr-4', timeStart: '17:25', timeEnd: '19:00', subject: "Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования", type: 'Практические занятия', location: "109б корпус № 1", teacher: "Колибасов Владимир Александрович" }
        ]
      },
      {
        dayName: 'Суббота',
        lessons: [
          { id: '310-w1-sa-1', timeStart: '08:00', timeEnd: '09:35', subject: "Техника и технология добычи нефти и газа", type: 'Лекции', location: "Корпус № 1, 1", teacher: "Синюгин Александр Александрович" },
          { id: '310-w1-sa-2', timeStart: '09:45', timeEnd: '11:20', subject: "Техника и технология добычи нефти и газа", type: 'Практические занятия', location: "Корпус № 1, 1", teacher: "Синюгин Александр Александрович" }
        ]
      }
    ],
    2: [
      {
        dayName: 'Понедельник',
        lessons: [
          { id: '310-w2-mo-1', timeStart: '09:45', timeEnd: '11:20', subject: "Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования", type: 'Лекции', location: "Корпус № 1, 109", teacher: "Парфенов Кирилл Викторович" },
          { id: '310-w2-mo-2', timeStart: '11:50', timeEnd: '13:25', subject: "Основы расчета колебаний динамического оборудования нефтяных и газовых промыслов", type: 'Лекции', location: "Корпус № 9, 409", teacher: "Коныгин Сергей Борисович" },
          { id: '310-w2-mo-3', timeStart: '13:35', timeEnd: '15:10', subject: "Основы расчета колебаний динамического оборудования нефтяных и газовых промыслов", type: 'Практические занятия', location: "Корпус № 1, 2", teacher: "Петровская Марина Владимировна" },
          { id: '310-w2-mo-4', timeStart: '15:40', timeEnd: '17:15', subject: "Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования", type: 'Практические занятия', location: "109б корпус № 1", teacher: "Колибасов Владимир Александрович" }
        ]
      },
      {
        dayName: 'Вторник',
        lessons: [
          { id: '310-w2-tu-1', timeStart: '09:45', timeEnd: '11:20', subject: "Практико-ориентированный проект", type: 'Практические занятия', location: "Корпус № 1, 4", teacher: "Колибасов Владимир Александрович" }
        ]
      },
      {
        dayName: 'Среда',
        lessons: [
          { id: '310-w2-we-1', timeStart: '09:45', timeEnd: '11:20', subject: "Конструирование и расчет сосудов и аппаратов нефтегазовых промыслов, работающих под давлением", type: 'Лекции', location: "Корпус № 9, 423", teacher: "Крючков Дмитрий Александрович" },
          { id: '310-w2-we-2', timeStart: '11:50', timeEnd: '13:25', subject: "Конструирование и расчет сосудов и аппаратов нефтегазовых промыслов, работающих под давлением", type: 'Практические занятия', location: "Корпус № 9, 423", teacher: "Крючков Дмитрий Александрович" },
          { id: '310-w2-we-3', timeStart: '13:35', timeEnd: '15:10', subject: "Элективные курсы по физической культуре и спорту", type: 'Практические занятия', location: "Спортивный комплекс", teacher: "Кафедра физического воспитания" }
        ]
      },
      {
        dayName: 'Четверг',
        lessons: [
          { id: '310-w2-th-1', timeStart: '08:00', timeEnd: '09:35', subject: "Основы военной подготовки", type: 'Лекции', location: "Корпус № 13, 0408", teacher: "Военный учебный центр" },
          { id: '310-w2-th-2', timeStart: '09:45', timeEnd: '11:20', subject: "Основы военной подготовки", type: 'Лекции', location: "Корпус № 13, 0408", teacher: "Военный учебный центр" }
        ]
      },
      {
        dayName: 'Пятница',
        lessons: [
          { id: '310-w2-fr-1', timeStart: '09:45', timeEnd: '11:20', subject: "Элективные курсы по физической культуре и спорту", type: 'Практические занятия', location: "Спортивный комплекс", teacher: "Кафедра физического воспитания" },
          { id: '310-w2-fr-2', timeStart: '11:50', timeEnd: '13:25', subject: "Техника и технология бурения нефтегазовых скважин", type: 'Практические занятия', location: "Корпус № 1, 4", teacher: "Драницына Елена Геннадьевна" },
          { id: '310-w2-fr-3', timeStart: '13:35', timeEnd: '15:10', subject: "Технологии ресурсоповышающей обработки", type: 'Практические занятия', location: "Корпус № 1, 109", teacher: "Ибатуллин Ильдар Дугласович" }
        ]
      },
      {
        dayName: 'Суббота',
        lessons: [
          { id: '310-w2-sa-1', timeStart: '08:00', timeEnd: '09:35', subject: "Техника и технология добычи нефти и газа", type: 'Практические занятия', location: "Корпус № 1, 1", teacher: "Синюгин Александр Александрович" },
          { id: '310-w2-sa-2', timeStart: '09:45', timeEnd: '11:20', subject: "Трубы нефтяного сортамента", type: 'Лекции', location: "Корпус № 1, 1", teacher: "Федосеев Денис Александрович" },
          { id: '310-w2-sa-3', timeStart: '11:50', timeEnd: '13:25', subject: "Трубы нефтяного сортамента", type: 'Практические занятия', location: "Корпус № 1, 1", teacher: "Федосеев Денис Александрович" },
          { id: '310-w2-sa-4', timeStart: '13:35', timeEnd: '15:10', subject: "Безопасность жизнедеятельности", type: 'Практические занятия', location: "Корпус № 7, 704", teacher: "Сидоров Артем Александрович" }
        ]
      }
    ],
    3: [
      {
        dayName: 'Понедельник',
        lessons: [
          { id: '310-w3-mo-1', timeStart: '11:50', timeEnd: '13:25', subject: "Элективные курсы по физической культуре и спорту", type: 'Практические занятия', location: "Спортивный комплекс", teacher: "Кафедра физического воспитания" },
          { id: '310-w3-mo-2', timeStart: '13:35', timeEnd: '15:10', subject: "Конструирование и расчет сосудов и аппаратов нефтегазовых промыслов, работающих под давлением", type: 'Лабораторные работы', location: "Корпус № 9, 423", teacher: "Крючков Дмитрий Александрович" },
          { id: '310-w3-mo-3', timeStart: '15:40', timeEnd: '17:15', subject: "Конструирование и расчет сосудов и аппаратов нефтегазовых промыслов, работающих под давлением", type: 'Лабораторные работы', location: "Корпус № 9, 423", teacher: "Крючков Дмитрий Александрович" },
          { id: '310-w3-mo-4', timeStart: '17:25', timeEnd: '19:00', subject: "Безопасность жизнедеятельности", type: 'Лекции', location: "Корпус № 1, 432", teacher: "Сорокина Людмила Владимировна" }
        ]
      },
      {
        dayName: 'Вторник',
        lessons: [
          { id: '310-w3-tu-1', timeStart: '08:00', timeEnd: '09:35', subject: "Технологии ресурсоповышающей обработки", type: 'Практические занятия', location: "Корпус № 1, 109", teacher: "Ибатуллин Ильдар Дугласович" },
          { id: '310-w3-tu-2', timeStart: '09:45', timeEnd: '11:20', subject: "Технологии ресурсоповышающей обработки", type: 'Лекции', location: "Корпус № 1, 4", teacher: "Ибатуллин Ильдар Дугласович" },
          { id: '310-w3-tu-3', timeStart: '11:50', timeEnd: '13:25', subject: "Конструирование и расчет сосудов и аппаратов нефтегазовых промыслов, работающих под давлением", type: 'Лекции', location: "Корпус № 9, 423", teacher: "Крючков Дмитрий Александрович" },
          { id: '310-w3-tu-4', timeStart: '13:35', timeEnd: '15:10', subject: "Конструирование и расчет сосудов и аппаратов нефтегазовых промыслов, работающих под давлением", type: 'Практические занятия', location: "Корпус № 9, 423", teacher: "Крючков Дмитрий Александрович" }
        ]
      },
      {
        dayName: 'Среда',
        lessons: [
          { id: '310-w3-we-1', timeStart: '08:00', timeEnd: '09:35', subject: "Техника и технология бурения нефтегазовых скважин", type: 'Лекции', location: "Корпус № 1, 4", teacher: "Драницына Елена Геннадьевна" },
          { id: '310-w3-we-2', timeStart: '09:45', timeEnd: '11:20', subject: "Техника и технология бурения нефтегазовых скважин", type: 'Практические занятия', location: "Корпус № 1, 4", teacher: "Драницына Елена Геннадьевна" },
          { id: '310-w3-we-3', timeStart: '11:50', timeEnd: '13:25', subject: "Компьютерное моделирование нефтегазового оборудования", type: 'Лекции', location: "Корпус № 1, 2", teacher: "Петровская Марина Владимировна" },
          { id: '310-w3-we-4', timeStart: '13:35', timeEnd: '15:10', subject: "Компьютерное моделирование нефтегазового оборудования", type: 'Практические занятия', location: "Корпус № 1, 2", teacher: "Петровская Марина Владимировна" }
        ]
      },
      {
        dayName: 'Четверг',
        lessons: [
          { id: '310-w3-th-1', timeStart: '11:50', timeEnd: '13:25', subject: "Основы военной подготовки", type: 'Практические занятия', location: "Корпус № 3, 208", teacher: "Военный учебный центр" },
          { id: '310-w3-th-2', timeStart: '13:35', timeEnd: '15:10', subject: "Основы военной подготовки", type: 'Практические занятия', location: "Корпус № 3, 208", teacher: "Военный учебный центр" }
        ]
      },
      {
        dayName: 'Пятница',
        lessons: [
          { id: '310-w3-fr-1', timeStart: '11:50', timeEnd: '13:25', subject: "Основы расчета колебаний динамического оборудования нефтяных и газовых промыслов", type: 'Лекции', location: "Корпус № 9, 409", teacher: "Коныгин Сергей Борисович" },
          { id: '310-w3-fr-2', timeStart: '13:35', timeEnd: '15:10', subject: "Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования", type: 'Лекции', location: "Корпус № 1, 109", teacher: "Парфенов Кирилл Викторович" },
          { id: '310-w3-fr-3', timeStart: '15:40', timeEnd: '17:15', subject: "Основы расчета колебаний динамического оборудования нефтяных и газовых промыслов", type: 'Практические занятия', location: "Корпус № 1, 2", teacher: "Петровская Марина Владимировна" },
          { id: '310-w3-fr-4', timeStart: '17:25', timeEnd: '19:00', subject: "Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования", type: 'Практические занятия', location: "109б корпус № 1", teacher: "Колибасов Владимир Александрович" }
        ]
      },
      {
        dayName: 'Суббота',
        lessons: [
          { id: '310-w3-sa-1', timeStart: '08:00', timeEnd: '09:35', subject: "Техника и технология добычи нефти и газа", type: 'Лекции', location: "Корпус № 1, 1", teacher: "Синюгин Александр Александрович" },
          { id: '310-w3-sa-2', timeStart: '09:45', timeEnd: '11:20', subject: "Техника и технология добычи нефти и газа", type: 'Практические занятия', location: "Корпус № 1, 1", teacher: "Синюгин Александр Александрович" }
        ]
      }
    ],
    4: [
      {
        dayName: 'Понедельник',
        lessons: [
          { id: '310-w4-mo-1', timeStart: '09:45', timeEnd: '11:20', subject: "Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования", type: 'Лекции', location: "Корпус № 1, 109", teacher: "Парфенов Кирилл Викторович" },
          { id: '310-w4-mo-2', timeStart: '11:50', timeEnd: '13:25', subject: "Основы расчета колебаний динамического оборудования нефтяных и газовых промыслов", type: 'Лекции', location: "Корпус № 9, 409", teacher: "Коныгин Сергей Борисович" },
          { id: '310-w4-mo-3', timeStart: '13:35', timeEnd: '15:10', subject: "Основы расчета колебаний динамического оборудования нефтяных и газовых промыслов", type: 'Практические занятия', location: "Корпус № 1, 2", teacher: "Петровская Марина Владимировна" },
          { id: '310-w4-mo-4', timeStart: '15:40', timeEnd: '17:15', subject: "Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования", type: 'Практические занятия', location: "109б корпус № 1", teacher: "Колибасов Владимир Александрович" }
        ]
      },
      {
        dayName: 'Вторник',
        lessons: [
          { id: '310-w4-tu-1', timeStart: '09:45', timeEnd: '11:20', subject: "Практико-ориентированный проект", type: 'Практические занятия', location: "Корпус № 1, 4", teacher: "Колибасов Владимир Александрович" },
          { id: '310-w4-tu-2', timeStart: '11:50', timeEnd: '13:25', subject: "Актуальные вопросы профессиональной деятельности и построение карьеры", type: 'Лекции', location: "Корпус № 7, 793", teacher: "" }
        ]
      },
      {
        dayName: 'Среда',
        lessons: [
          { id: '310-w4-we-1', timeStart: '09:45', timeEnd: '11:20', subject: "Конструирование и расчет сосудов и аппаратов нефтегазовых промыслов, работающих под давлением", type: 'Лекции', location: "Корпус № 9, 423", teacher: "Крючков Дмитрий Александрович" },
          { id: '310-w4-we-2', timeStart: '11:50', timeEnd: '13:25', subject: "Конструирование и расчет сосудов и аппаратов нефтегазовых промыслов, работающих под давлением", type: 'Практические занятия', location: "Корпус № 9, 423", teacher: "Крючков Дмитрий Александрович" },
          { id: '310-w4-we-3', timeStart: '13:35', timeEnd: '15:10', subject: "Элективные курсы по физической культуре и спорту", type: 'Практические занятия', location: "Спортивный комплекс", teacher: "Кафедра физического воспитания" }
        ]
      },
      {
        dayName: 'Четверг',
        lessons: [
          { id: '310-w4-th-1', timeStart: '08:00', timeEnd: '09:35', subject: "Основы военной подготовки", type: 'Лекции', location: "Корпус № 13, 0408", teacher: "Военный учебный центр" },
          { id: '310-w4-th-2', timeStart: '09:45', timeEnd: '11:20', subject: "Основы военной подготовки", type: 'Лекции', location: "Корпус № 13, 0408", teacher: "Военный учебный центр" }
        ]
      },
      {
        dayName: 'Пятница',
        lessons: [
          { id: '310-w4-fr-1', timeStart: '09:45', timeEnd: '11:20', subject: "Элективные курсы по физической культуре и спорту", type: 'Практические занятия', location: "Спортивный комплекс", teacher: "Кафедра физического воспитания" },
          { id: '310-w4-fr-2', timeStart: '11:50', timeEnd: '13:25', subject: "Техника и технология бурения нефтегазовых скважин", type: 'Практические занятия', location: "Корпус № 1, 4", teacher: "Драницына Елена Геннадьевна" },
          { id: '310-w4-fr-3', timeStart: '13:35', timeEnd: '15:10', subject: "Технологии ресурсоповышающей обработки", type: 'Практические занятия', location: "Корпус № 1, 109", teacher: "Ибатуллин Ильдар Дугласович" }
        ]
      },
      {
        dayName: 'Суббота',
        lessons: [
          { id: '310-w4-sa-1', timeStart: '08:00', timeEnd: '09:35', subject: "Техника и технология добычи нефти и газа", type: 'Практические занятия', location: "Корпус № 1, 1", teacher: "Синюгин Александр Александрович" },
          { id: '310-w4-sa-2', timeStart: '09:45', timeEnd: '11:20', subject: "Трубы нефтяного сортамента", type: 'Лекции', location: "Корпус № 1, 1", teacher: "Федосеев Денис Александрович" },
          { id: '310-w4-sa-3', timeStart: '11:50', timeEnd: '13:25', subject: "Трубы нефтяного сортамента", type: 'Практические занятия', location: "Корпус № 1, 1", teacher: "Федосеев Денис Александрович" },
          { id: '310-w4-sa-4', timeStart: '13:35', timeEnd: '15:10', subject: "Безопасность жизнедеятельности", type: 'Практические занятия', location: "Корпус № 7, 704", teacher: "Сидоров Артем Александрович" }
        ]
      }
    ]
  }
};

export const createEmptyWeek = (): DaySchedule[] => [
  { dayName: 'Понедельник', lessons: [] },
  { dayName: 'Вторник', lessons: [] },
  { dayName: 'Среда', lessons: [] },
  { dayName: 'Четверг', lessons: [] },
  { dayName: 'Пятница', lessons: [] },
  { dayName: 'Суббота', lessons: [] }
];

// Canonical aliases for bundled default group ingt-310 (3-ИНГТ-110)
SCHEDULE_REGISTRY['3-ингт-110'] = SCHEDULE_REGISTRY['ingt-310'];
SCHEDULE_REGISTRY['3-ingt-110'] = SCHEDULE_REGISTRY['ingt-310'];
SCHEDULE_REGISTRY['24ингт-110'] = SCHEDULE_REGISTRY['ingt-310'];
SCHEDULE_REGISTRY['25ингт-110'] = SCHEDULE_REGISTRY['ingt-310'];

// Helper for Telegram tags
export const getGroupTag = (groupName: string): string => {
  return groupName.replace(/-/g, '');
};

// Safe initialization of all groups in AVAILABLE_GROUPS to empty weeks until loaded on-demand
AVAILABLE_GROUPS.forEach(grp => {
  if (!SCHEDULE_REGISTRY[grp.id]) {
    SCHEDULE_REGISTRY[grp.id] = {
      1: createEmptyWeek(),
      2: createEmptyWeek(),
      3: createEmptyWeek(),
      4: createEmptyWeek()
    };
  }
});
