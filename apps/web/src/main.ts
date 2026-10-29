// SPDX-License-Identifier: AGPL-3.0-only
import { Component, inject } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, RouterOutlet, Router, CanActivateFn } from '@angular/router';
import { Api, Theme } from './api';
import { Login } from './login';
import { Panel } from './panel';

const access: CanActivateFn = async route => { const api = inject(Api), router = inject(Router); const actor = api.identity() ?? await api.me(); if (!actor) return router.parseUrl('/login'); if (route.routeConfig?.path?.startsWith('admin') && actor.kind !== 'ADMIN') return router.parseUrl('/player/overview'); if (route.routeConfig?.path?.startsWith('player') && actor.kind !== 'PLAYER') return router.parseUrl('/admin/overview'); return true; };
@Component({ selector: 'vos-root', imports: [RouterOutlet], template: '<router-outlet />' }) class App { theme = inject(Theme); }
bootstrapApplication(App, { providers: [provideRouter([{ path: 'login', component: Login }, { path: 'admin/:section', component: Panel, canActivate: [access] }, { path: 'player/:section', component: Panel, canActivate: [access] }, { path: '', pathMatch: 'full', redirectTo: 'admin/overview' }, { path: '**', redirectTo: 'admin/overview' }])] }).catch(() => { document.body.textContent = 'Não foi possível iniciar o painel. Atualize a página.'; });
