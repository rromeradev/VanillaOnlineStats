// SPDX-License-Identifier: AGPL-3.0-only
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, Theme } from './api';
@Component({ selector: 'vos-login', imports: [FormsModule], template: `
<div class="login-page"><section class="login-story"><a class="brand" href="/"><span class="brand-mark"><i></i><i></i><i></i><i></i></span><span>Vanilla<span class="brand-sub">OnlineStats</span></span></a>
<div class="story-content"><span class="eyebrow">CADA MUNDO TEM UMA HISTÓRIA</span><h1>Seu servidor.<br>Uma nova<br><em>perspectiva.</em></h1><p>Acompanhe seu mundo, entenda o desempenho e cuide da sua comunidade.</p>
<div class="story-grid"><span class="world-block b1"></span><span class="world-block b2"></span><span class="world-block b3"></span><span class="world-block b4"></span><div class="story-note"><span class="live-dot"></span>Paper + AuthMe<span>Observabilidade conectada ao jogo</span></div></div>
<div class="story-features"><span>↗ Visão do servidor</span><span>◈ Jornada do jogador</span><span>✓ Controle com auditoria</span></div></div><small>Self-hosted · Código aberto · AGPL-3.0</small></section>
<section class="login-form-side"><div class="login-top"><span>SEU MUNDO, CONECTADO</span><button class="icon-button" (click)="cycleTheme()" aria-label="Alternar tema">{{theme.choice() === 'dark' ? '☾' : theme.choice() === 'light' ? '☀' : '◐'}}</button></div>
<main class="login-card"><div class="login-emblem">◈</div><h2>Bem-vindo ao portal</h2><p class="muted">Entre para acompanhar o que acontece no seu servidor.</p>
@if (api.info().demo) {<div class="notice">Ambiente de demonstração · dados simulados identificados.</div>}
<div class="segmented login-tabs" role="tablist"><button role="tab" [attr.aria-selected]="mode() === 'admin'" [class.selected]="mode() === 'admin'" (click)="selectMode('admin')">Administração</button><button role="tab" [attr.aria-selected]="mode() === 'player'" [class.selected]="mode() === 'player'" (click)="selectMode('player')">Sou jogador</button></div>
@if (error()) {<div class="error-banner" role="alert">{{error()}}</div>}
<form (ngSubmit)="submit()">@if (mode() === 'admin') {
<label>E-mail<input type="email" [(ngModel)]="email" name="email" autocomplete="username" required placeholder="voce@exemplo.com"></label>
<label>Senha<input type="password" [(ngModel)]="password" name="password" autocomplete="current-password" required placeholder="Sua senha de administrador"></label>
} @else {
<div class="helper-box">Entre com seu nick e a senha cadastrada no AuthMe. Você pode estar offline no jogo.</div>
@if(publicServers().length > 1){<label>Servidor<select [(ngModel)]="serverId" name="server" required><option value="">Selecione seu servidor</option>@for(server of publicServers(); track server.id){<option [value]="server.id">{{server.name}}</option>}</select></label>}
<label>Nick do Minecraft<input [(ngModel)]="nickname" name="nickname" autocomplete="username" required minlength="3" maxlength="16" placeholder="Seu nick"></label><label>Senha do AuthMe<input type="password" [(ngModel)]="password" name="playerPassword" autocomplete="current-password" maxlength="128" required placeholder="Sua senha do AuthMe"></label>
@if (!publicServers().length) {<p class="muted small">Nenhum servidor habilitou o acesso de jogadores ainda.</p>}
}<button class="button primary full" type="submit" [disabled]="busy()">{{busy() ? 'Verificando…' : 'Entrar no portal'}} <span>↗</span></button></form>
<p class="login-help">@if(mode() === 'player'){A senha é validada pelo AuthMe do servidor.<br>Você não precisa entrar no jogo para acessar o portal.}@else{Use sua conta administrativa do portal.}</p></main>
<footer class="login-footer"><a href="https://github.com/rromeradev/VanillaOnlineStats" target="_blank" rel="noopener">Código-fonte ↗</a><span>VanillaOnlineStats {{api.info().version}}</span></footer></section></div>` })
export class Login {
  api = inject(Api); theme = inject(Theme); router = inject(Router); mode = signal<'admin' | 'player'>('admin'); error = signal(''); busy = signal(false); publicServers = signal<any[]>([]);
  email = ''; password = ''; serverId = ''; code = ''; nickname = '';
  constructor() { void this.api.request('public/info').then(value => this.api.info.set(value)); void this.api.request<any[]>('public/servers').then(value => { this.publicServers.set(value); if(value.length === 1) this.serverId = value[0].id; }); }
  selectMode(value: 'admin' | 'player') { this.password = ''; this.error.set(''); this.mode.set(value); }
  cycleTheme() { this.theme.set(this.theme.choice() === 'auto' ? 'light' : this.theme.choice() === 'light' ? 'dark' : 'auto'); }
  async submit() { this.error.set(''); this.busy.set(true); try { const value = await this.api.post(this.mode() === 'admin' ? 'auth/admin/login' : 'auth/player/login', this.mode() === 'admin' ? { email: this.email, password: this.password } : { serverId: this.serverId, nickname: this.nickname, password: this.password }); this.password = ''; this.code = ''; this.nickname = ''; this.api.identity.set(value); await this.router.navigateByUrl(value.kind === 'ADMIN' ? '/admin/overview' : '/player/overview'); } catch (error: any) { this.error.set(error.message); } finally { this.busy.set(false); } }
}
