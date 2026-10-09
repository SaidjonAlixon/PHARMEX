import {
  ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Ban, Banknote, CircleDollarSign, CircleDot, CreditCard, HandCoins,
  Landmark, Layers, PiggyBank, Receipt, RotateCcw, Truck, Undo2, UserCheck, Vault, Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MenuOption } from '@/components/select-menu';
import { moneyTypeLabels, paymentLabels } from '@/lib/labels';

const paymentIcons: Record<string, [LucideIcon, string]> = {
  cash: [Banknote, '#1fb84f'],
  card: [CreditCard, '#1f5fd0'],
  transfer: [ArrowLeftRight, '#6d4fd8'],
  credit: [HandCoins, '#e48a0c'],
  other: [CircleDot, '#55657f'],
};

export const paymentMenu: MenuOption[] = [
  { value: '', label: 'Barcha toʻlovlar', icon: Layers, color: '#0fb3c7' },
  ...Object.entries(paymentLabels).filter(([k]) => k !== 'mixed').map(([value, label]) => {
    const [icon, color] = paymentIcons[value] ?? [CircleDot, '#55657f'];
    return { value, label, icon, color };
  }),
];

const moneyTypeIcons: Record<string, [LucideIcon, string]> = {
  sale: [Receipt, '#1fb84f'],
  sale_refund: [Undo2, '#e48a0c'],
  sale_void: [Ban, '#e0484f'],
  cash_in: [ArrowDownToLine, '#1fb84f'],
  cash_out: [ArrowUpFromLine, '#e0484f'],
  bank_receipt: [Landmark, '#1f5fd0'],
  encashment: [Vault, '#13306e'],
  transfer: [ArrowLeftRight, '#6d4fd8'],
  supplier_payment: [Truck, '#0b8fa3'],
  supplier_refund: [RotateCcw, '#0fb3c7'],
  customer_payment: [UserCheck, '#179a45'],
  expense: [CircleDollarSign, '#e0484f'],
  owner_in: [PiggyBank, '#1fb84f'],
  owner_out: [Wallet, '#e48a0c'],
};

export const moneyTypeMenu: MenuOption[] = [
  { value: '', label: 'Barcha turlar', icon: Layers, color: '#0fb3c7' },
  ...Object.entries(moneyTypeLabels).filter(([k]) => k !== 'Xarajat').map(([value, label]) => {
    const [icon, color] = moneyTypeIcons[value] ?? [CircleDot, '#55657f'];
    return { value, label, icon, color };
  }),
];
