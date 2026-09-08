import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'transactions' },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardPage),
  },
  {
    path: 'transactions',
    loadComponent: () =>
      import('./pages/transactions/transactions').then((m) => m.TransactionsPage),
  },
  {
    path: 'accounts',
    loadComponent: () => import('./pages/accounts/accounts').then((m) => m.AccountsPage),
  },
  {
    path: 'categories',
    loadComponent: () => import('./pages/categories/categories').then((m) => m.CategoriesPage),
  },
  {
    path: 'fixed-deposits',
    loadComponent: () =>
      import('./pages/fixed-deposits/fixed-deposits').then((m) => m.FixedDepositsPage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: 'transactions' },
];
