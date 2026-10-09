import {
  Activity, ArrowLeftRight, BookOpen, Building2, FileBarChart2, HandCoins, LayoutDashboard, ShieldCheck, ShoppingCart,
  Sparkles, Truck, Users, Wallet, Workflow, CircleHelp, PlugZap, type LucideIcon,
} from 'lucide-react';

export type SitePage = { href: string; label: string; short: string; icon: LucideIcon };

export const sitePages: SitePage[] = [
  { href: '/imkoniyatlar', label: 'Imkoniyatlar', short: '10 ta modul: savdodan foydagacha', icon: Sparkles },
  { href: '/yechimlar', label: 'Yechimlar', short: 'Kimlar uchun va nima uchun', icon: Users },
  { href: '/qanday-ishlaydi', label: 'Qanday ishlaydi', short: 'Hujjatdan qarorgacha zanjir', icon: Workflow },
  { href: '/integratsiya', label: 'Integratsiya', short: 'FOM F-APTEKA bilan real vaqt', icon: PlugZap },
  { href: '/xavfsizlik', label: 'Xavfsizlik', short: 'Rollar, audit va himoya', icon: ShieldCheck },
  { href: '/savollar', label: 'Savollar', short: 'Koʻp beriladigan savollar', icon: CircleHelp },
];

export type Module = { id: string; icon: LucideIcon; color: string; title: string; short: string; text: string; points: string[] };

export const modules: Module[] = [
  {
    id: 'dashboard', icon: LayoutDashboard, color: '#0fb3c7', title: 'Bosh dashboard', short: 'Guruh holati bir qarashda',
    text: 'Savdo, yalpi foyda, kassa qoldigʻi, qarzlar va ogohlantirishlar — tanlangan davr va filial boʻyicha bitta ekranda.',
    points: ['Davr va filial boʻyicha global filtr', 'Savdo dinamikasi grafigi', 'Muddati oʻtgan qarz va kam qoldiq ogohlantirishlari', 'Har bir raqam manbasi bilan'],
  },
  {
    id: 'filiallar', icon: Building2, color: '#1f5fd0', title: 'Filiallar', short: 'Har bir nuqta alohida nazoratda',
    text: 'Dorixona va omborlar roʻyxati, har bir filialning savdosi, qoldigʻi va pul oqimi alohida kartada.',
    points: ['Dorixona va markaziy ombor turlari', 'Filial kesimidagi koʻrsatkichlar', 'FOM dan avtomatik filiallar', 'Filiallarni solishtirish'],
  },
  {
    id: 'savdolar', icon: ShoppingCart, color: '#1fb84f', title: 'Savdolar', short: 'Cheklar, qaytarish, bekor qilish',
    text: 'Har bir chek: toʻlov turlari, chegirma, narx ichidagi QQS, tannarx va yalpi foyda. Qaytarish va bekor qilish izi saqlanadi.',
    points: ['Naqd, karta, oʻtkazma, nasiya — aralash toʻlov', 'Qisman va toʻliq qaytarish', 'Bekor qilingan cheklar alohida', 'Mahsulot qatorlari boʻyicha tahlil'],
  },
  {
    id: 'kirim', icon: Truck, color: '#e48a0c', title: 'Kirim', short: 'Yetkazib beruvchidan omborgacha',
    text: 'Kirim hujjatlari tannarx, partiya va yaroqlilik muddati bilan. Toʻlanmagan qism avtomatik ravishda kreditor qarzga aylanadi.',
    points: ['Partiya va yaroqlilik muddati', 'Toʻlov holati: toʻlangan / qisman / qarz', 'Yetkazib beruvchi qarzi avtomatik', 'Hujjat raqami va sana nazorati'],
  },
  {
    id: 'tovar-harakati', icon: ArrowLeftRight, color: '#6d4fd8', title: 'Tovar harakati', short: 'Oʻtkazma, hisobdan chiqarish, inventarizatsiya',
    text: 'Filiallararo oʻtkazma, hisobdan chiqarish, yetkazib beruvchiga qaytarish va inventarizatsiya — har bir harakat hujjat bilan.',
    points: ['Filiallararo oʻtkazma', 'Sabab bilan hisobdan chiqarish', 'Inventarizatsiya: kamomad va ortiqcha', 'Har bir tovar harakat tarixi'],
  },
  {
    id: 'pul', icon: Wallet, color: '#0b8fa3', title: 'Pul operatsiyalari', short: 'Kassa, bank, inkassatsiya',
    text: 'Kassalar va bank hisoblari: boshlangʻich va yakuniy qoldiq, kirim-chiqim, inkassatsiya, xarajatlar va egalar mablagʻi.',
    points: ['Kassa va bank hisoblari', 'Inkassatsiya va hisoblararo oʻtkazma', 'Xarajatlar kategoriyalar boʻyicha', 'Egalar kiritgan va olgan mablagʻ'],
  },
  {
    id: 'qarzlar', icon: HandCoins, color: '#e0484f', title: 'Qarzlar', short: 'Debitor va kreditor nazorati',
    text: 'Mijoz va yetkazib beruvchi qarzlari muddati bilan. Toʻlov, qaytarish va hisobdan chiqarish operatsiyalari tarixi bilan.',
    points: ['Muddati oʻtganlar ajratiladi', 'Qisman toʻlovlar tarixi', 'Hamkor boʻyicha qoldiq', 'Nasiya savdodan avtomatik qarz'],
  },
  {
    id: 'malumotnomalar', icon: BookOpen, color: '#13306e', title: 'Maʼlumotnomalar', short: 'Tovarlar va hamkorlar',
    text: 'Yagona tovar katalogi (IKPU, birlik, QQS stavkasi) va hamkorlar: yetkazib beruvchilar hamda mijozlar.',
    points: ['IKPU, oʻlchov birligi, QQS', 'Yetkazib beruvchi va mijozlar', 'FOM dan avtomatik toʻldirish', 'Tez qidiruv'],
  },
  {
    id: 'foyda', icon: Activity, color: '#179a45', title: 'Foyda va zarar', short: 'Sof natija aniq',
    text: 'Savdo tushumi, tannarx, yalpi foyda, xarajatlar va sof foyda — filial va davr kesimida, qaytarishlar hisobga olingan holda.',
    points: ['Yalpi va sof foyda', 'Xarajatlar taqsimoti', 'Qaytarish va bekor qilish hisobga olinadi', 'Filiallar boʻyicha solishtirish'],
  },
  {
    id: 'hisobotlar', icon: FileBarChart2, color: '#1f5fd0', title: 'Hisobotlar', short: 'Kerakli kesimda, bir bosishda',
    text: 'Davr va filial boʻyicha tayyor hisobotlar: savdo, qoldiq, pul oqimi, qarzlar. Raqamlar bir xil manbadan olinadi.',
    points: ['Davr va filial tanlovi', 'Tayyor hisobot turlari', 'Bir xil manba — bir xil raqam', 'Yuklab olish'],
  },
];
