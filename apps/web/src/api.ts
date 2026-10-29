// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable, signal } from '@angular/core';
export interface Identity { kind: 'ADMIN' | 'PLAYER'; displayName: string; serverId?: string; csrf: string; expiresAt: string }
@Injectable({ providedIn: 'root' })
export class Api {
  identity = signal<Identity | null>(null);
  info = signal<any>({});
  async request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body) headers.set('Content-Type', 'application/json');
    if (this.identity()?.csrf) headers.set('X-CSRF-Token', this.identity()!.csrf);
    const response = await fetch('/api/v1/' + path, { ...options, signal:options.signal??AbortSignal.timeout(35000), credentials: 'same-origin', headers });
    if (!response.ok) {
      if (response.status === 401 && !['auth/admin/login','auth/reauth','auth/password'].includes(path)) this.identity.set(null);
      const message: Record<number, string> = { 400: 'Confira os campos informados.', 401: 'Sessão ou credenciais inválidas. Entre novamente.',
        403: 'Você não tem permissão ou precisa confirmar novamente sua identidade.', 404: 'Recurso não disponível nesta conta.',
        409: 'Conflito de dados ou atualização do plugin necessária.', 429: 'Muitas solicitações. Aguarde um pouco e tente novamente.',
        503: 'O servidor está sem canal de controle. Confira a conexão do plugin.' };
      throw new Error(message[response.status] ?? 'Não foi possível concluir. Tente novamente em instantes.');
    }
    return response.json();
  }
  async me() { try { this.identity.set(await this.request<Identity>('auth/me')); } catch { this.identity.set(null); } return this.identity(); }
  post<T = any>(path: string, body: any = {}) { return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
}
@Injectable({ providedIn: 'root' })
export class Theme {
  choice = signal<'auto' | 'light' | 'dark'>('auto');
  private media = matchMedia('(prefers-color-scheme: dark)');
  constructor() {
    const saved = localStorage.getItem('vos_theme'); if (saved === 'light' || saved === 'dark') this.choice.set(saved);
    this.apply(); this.media.addEventListener('change', () => this.apply());
  }
  set(value: 'auto' | 'light' | 'dark') { this.choice.set(value); localStorage.setItem('vos_theme', value); this.apply(); }
  private apply() { const mode = this.choice() === 'auto' ? this.media.matches ? 'dark' : 'light' : this.choice(); document.documentElement.dataset['theme'] = mode; document.documentElement.style.colorScheme = mode; }
}
