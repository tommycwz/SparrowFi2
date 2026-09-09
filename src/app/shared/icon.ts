import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Small inline-SVG icon set (Feather-style, MIT-licensed shapes redrawn by
 * hand) so the app never depends on an external icon font/CDN - everything
 * needed to render the UI ships in the app bundle and works fully offline.
 */
@Component({
  selector: 'sf-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @switch (name()) {
        @case ('folder-open') {
          <path
            d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1H8a2 2 0 0 0-1.9 1.37L3 19V7Z"
          /><path d="m3 19 2.7-8.1A2 2 0 0 1 7.6 9.6H21l-2.7 8.1A2 2 0 0 1 16.4 19H3Z" />
        }
        @case ('save') {
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
          <path d="M17 21v-8H7v8" /><path d="M7 3v5h8" />
        }
        @case ('download') {
          <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
        }
        @case ('share') {
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4" /><path d="m15.4 6.5-6.8 4" />
        }
        @case ('plus') {
          <path d="M12 5v14" /><path d="M5 12h14" />
        }
        @case ('edit') {
          <path d="M12 20h9" />
          <path
            d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"
          />
        }
        @case ('trash') {
          <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        }
        @case ('x') {
          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
        }
        @case ('check') {
          <path d="M20 6 9 17l-5-5" />
        }
        @case ('chevron-down') {
          <path d="m6 9 6 6 6-6" />
        }
        @case ('wallet') {
          <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
          <path d="M21 12h-4a2 2 0 0 0 0 4h4v-4Z" />
        }
        @case ('bank') {
          <path d="m3 10 9-6 9 6" /><path d="M5 10v9" /><path d="M9 10v9" />
          <path d="M15 10v9" /><path d="M19 10v9" /><path d="M3 19h18" />
        }
        @case ('card') {
          <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" />
        }
        @case ('tag') {
          <path
            d="M12.6 2.6a2 2 0 0 1 1.4-.6H20a2 2 0 0 1 2 2v6a2 2 0 0 1-.6 1.4l-9 9a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1 0-2.8Z"
          /><circle cx="16.5" cy="7.5" r="1.5" />
        }
        @case ('layers') {
          <path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" />
          <path d="m3 17 9 5 9-5" />
        }
        @case ('calendar') {
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" />
          <path d="M8 2v4" /><path d="M3 10h18" />
        }
        @case ('settings') {
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
          />
        }
        @case ('lock') {
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        }
        @case ('unlock') {
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.4-2.4" />
        }
        @case ('key') {
          <circle cx="7.5" cy="15.5" r="5.5" />
          <path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" />
        }
        @case ('home') {
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M9 22V12h6v10" />
        }
        @case ('list') {
          <path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" />
          <path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />
        }
        @case ('menu') {
          <path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" />
        }
        @case ('alert-triangle') {
          <path
            d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z"
          /><path d="M12 9v4" /><path d="M12 17h.01" />
        }
        @case ('copy') {
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        }
        @case ('info') {
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
        }
        @case ('chevron-right') {
          <path d="m9 18 6-6-6-6" />
        }
        @case ('chevron-left') {
          <path d="m15 18-6-6 6-6" />
        }
        @case ('arrow-left') {
          <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
        }
        @case ('sun') {
          <circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" /><path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
        }
        @case ('moon') {
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        }
        @case ('monitor') {
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" /><path d="M12 17v4" />
        }
        @case ('upload') {
          <path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" />
        }
        @case ('search') {
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" />
        }
        @case ('cloud') {
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        }
        @case ('log-out') {
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
        }
      }
    </svg>
  `,
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input<number>(20);
}
