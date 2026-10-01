export interface SamgtuGroupMeta {
  name: string;
  samgtuName: string;
  samgtuGroupId: number;
}

export const SAMGTU_GROUP_MAP: Record<string, SamgtuGroupMeta> = {
  // ИНГТ 3 курс (весь поток 101–114)
  'ingt-301': { name: '3-ИНГТ-101', samgtuName: 'Группа 24ИНГТ-101', samgtuGroupId: 31661 },
  'ingt-302': { name: '3-ИНГТ-102', samgtuName: 'Группа 24ИНГТ-102', samgtuGroupId: 31662 },
  'ingt-303': { name: '3-ИНГТ-103', samgtuName: 'Группа 24ИНГТ-103', samgtuGroupId: 31659 },
  'ingt-304': { name: '3-ИНГТ-104', samgtuName: 'Группа 24ИНГТ-104', samgtuGroupId: 31660 },
  'ingt-305': { name: '3-ИНГТ-105', samgtuName: 'Группа 24ИНГТ-105', samgtuGroupId: 31653 },
  'ingt-306': { name: '3-ИНГТ-106', samgtuName: 'Группа 24ИНГТ-106', samgtuGroupId: 31654 },
  'ingt-307': { name: '3-ИНГТ-107', samgtuName: 'Группа 24ИНГТ-107', samgtuGroupId: 31601 },
  'ingt-308': { name: '3-ИНГТ-108', samgtuName: 'Группа 24ИНГТ-108', samgtuGroupId: 31646 },
  'ingt-309': { name: '3-ИНГТ-109', samgtuName: 'Группа 24ИНГТ-109', samgtuGroupId: 31584 },
  'ingt-310': { name: '3-ИНГТ-110', samgtuName: 'Группа 24ИНГТ-110', samgtuGroupId: 31647 },
  'ingt-311': { name: '3-ИНГТ-111', samgtuName: 'Группа 24ИНГТ-111', samgtuGroupId: 31663 },
  'ingt-312': { name: '3-ИНГТ-112', samgtuName: 'Группа 24ИНГТ-112', samgtuGroupId: 31648 },
  'ingt-313': { name: '3-ИНГТ-113', samgtuName: 'Группа 24ИНГТ-113', samgtuGroupId: 31765 },
  'ingt-314': { name: '3-ИНГТ-114', samgtuName: 'Группа 24ИНГТ-114', samgtuGroupId: 31762 },

  // Другие факультеты и курсы
  'faid-310': { name: '3-ФАИД-110', samgtuName: 'Группа 24ФАД-110', samgtuGroupId: 31745 },
  'ingt-209': { name: '2-ИНГТ-109', samgtuName: 'Группа 25ИНГТ-109', samgtuGroupId: 32385 },
  'htf-215':  { name: '2-ХТФ-115',  samgtuName: 'Группа 25ХТФ-115',  samgtuGroupId: 32410 }
};
