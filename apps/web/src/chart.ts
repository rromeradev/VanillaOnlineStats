// SPDX-License-Identifier: AGPL-3.0-only
import { Component, computed, input } from '@angular/core';
@Component({
  selector: 'vos-chart',
  template: `@if (values().length > 1) {
    <div class="plot"><div class="plot-labels"><span>{{maxLabel()}}</span><span>{{midLabel()}}</span><span>{{minLabel()}}</span></div>
    <svg viewBox="0 0 900 220" role="img" [attr.aria-label]="label() + ', ' + values().length + ' amostras'">
      <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".18"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      @for (y of [10,60,110,160,210]; track y) {<line x1="0" x2="900" [attr.y1]="y" [attr.y2]="y" stroke="var(--line)" stroke-dasharray="3 5"/>}
      <polygon [attr.points]="'0,210 ' + points() + ' 900,210'" fill="url(#chart-fill)"/>
      <polyline [attr.points]="points()" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      @for (point of dots(); track $index) {<circle [attr.cx]="point.x" [attr.cy]="point.y" r="3" fill="var(--accent)"><title>{{point.label}}</title></circle>}
    </svg><div class="plot-times"><span>{{firstTime()}}</span><span>{{lastTime()}}</span></div></div>
  } @else {<div class="empty chart-empty"><span class="empty-icon">⌁</span><strong>Aguardando histórico</strong><p>O gráfico aparece quando houver pelo menos duas amostras reais.</p></div>}`,
})
export class Chart {
  data = input<any[]>([]); metric = input('tps'); label = input('Desempenho');
  values = computed(() => this.data().map(entry => ({ at: entry.occurredAt, value: this.metric() === 'tps' ? Number(entry.payload.tps?.[0]) : this.metric() === 'heap' ? Number(entry.payload.heapUsed) / 1024 ** 3 : Number(entry.payload.msptAverage) })).filter(p => Number.isFinite(p.value)));
  max = computed(() => this.metric() === 'tps' ? Math.max(20, ...this.values().map(p => p.value)) : Math.max(1, ...this.values().map(p => p.value)) * 1.1);
  min = computed(() => this.metric() === 'tps' ? Math.max(0, Math.min(...this.values().map(p => p.value)) - 1) : 0);
  dots = computed(() => { const all = this.values(), step = Math.max(1, Math.ceil(all.length / 160)), samples = all.filter((_, i) => i % step === 0 || i === all.length - 1); return samples.map((p, i) => ({ x: i / Math.max(1, samples.length - 1) * 900, y: 210 - (p.value - this.min()) / Math.max(.01, this.max() - this.min()) * 200, label: new Date(p.at).toLocaleString('pt-BR') + ' · ' + p.value.toFixed(2) })); });
  points = computed(() => this.dots().map(p => `${p.x},${p.y}`).join(' '));
  maxLabel = computed(() => this.max().toFixed(1)); minLabel = computed(() => this.min().toFixed(1)); midLabel = computed(() => ((this.max() + this.min()) / 2).toFixed(1));
  firstTime = computed(() => this.values()[0] ? new Date(this.values()[0].at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
  lastTime = computed(() => this.values().at(-1) ? new Date(this.values().at(-1)!.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
}
