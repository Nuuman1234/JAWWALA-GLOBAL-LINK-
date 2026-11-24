import type { SVGProps } from 'react';

interface FdmisCrestProps {
  className?: string;
}

/**
 * Crisp Nigerian civic heraldic emblem for FDMIS headers and authentication banners.
 * Pure inline SVG for instant offline rendering with zero external dependencies.
 */
export function FdmisCrest({ className = 'h-9 w-10' }: FdmisCrestProps) {
  return (
    <svg
      viewBox="0 0 64 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Supporting heraldic wings / flourishes */}
      <path
        d="M15 20C9 21 6 26 7 33C8 38 12 42 18 43L21 37C16 36 14 33 14 29C14 26 16 24 19 23L15 20Z"
        fill="#FFFFFF"
        stroke="#06452F"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M49 20C55 21 58 26 57 33C56 38 52 42 46 43L43 37C48 36 50 33 50 29C50 26 48 24 45 23L49 20Z"
        fill="#FFFFFF"
        stroke="#06452F"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Top Eagle Crest */}
      <path
        d="M23 11C25 7.5 28.5 6 32 6C35.5 6 39 7.5 41 11L36 13.5H28L23 11Z"
        fill="#DC4C45"
        stroke="#7F1D1D"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Green & White Wreath */}
      <rect x="24" y="14" width="16" height="3.2" rx="1.6" fill="#168653" />
      <rect x="28.5" y="14" width="7" height="3.2" fill="#FFFFFF" />
      {/* Central Shield */}
      <path
        d="M20 18.5H44V31C44 38.5 38.5 43.8 32 46C25.5 43.8 20 38.5 20 31V18.5Z"
        fill="#102B3F"
        stroke="#D99A32"
        strokeWidth="1.8"
      />
      {/* White Y Pall (Niger-Benue confluence motif) */}
      <path
        d="M22.5 20.5L32 31L41.5 20.5M32 31V43.5"
        stroke="#FFFFFF"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Green Base Banner & Gold Trim */}
      <path
        d="M15 44.5C21 48.2 43 48.2 49 44.5L47 49.5C41 52.5 23 52.5 17 49.5L15 44.5Z"
        fill="#168653"
        stroke="#043B29"
        strokeWidth="1"
      />
      <path
        d="M19 47.2C25 49.6 39 49.6 45 47.2"
        stroke="#F6D365"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Subtle Nigerian National Assembly dome silhouette blended into forest-green hero banners.
 */
export function NationalDomeBackdrop({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 280 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Soft radial ambient arcs */}
      <path
        d="M10 155C65 70 155 25 275 15"
        stroke="#4ADE80"
        strokeOpacity="0.14"
        strokeWidth="26"
      />
      <path
        d="M55 160C115 95 190 55 280 48"
        stroke="#A7F3D0"
        strokeOpacity="0.1"
        strokeWidth="18"
      />
      {/* Spire */}
      <line x1="196" y1="12" x2="196" y2="28" stroke="#D8F5E3" strokeOpacity="0.55" strokeWidth="2.5" />
      <circle cx="196" cy="11" r="2.5" fill="#D8F5E3" fillOpacity="0.6" />
      {/* Main Dome */}
      <path
        d="M154 66C154 41 172 25 196 25C220 25 238 41 238 66H154Z"
        fill="#168653"
        fillOpacity="0.52"
        stroke="#A7F3D0"
        strokeOpacity="0.32"
        strokeWidth="1.2"
      />
      {/* Dome vertical ribs */}
      <path
        d="M196 25V66M175 29C172 42 170 54 170 66M217 29C220 42 222 54 222 66"
        stroke="#D8F5E3"
        strokeOpacity="0.24"
        strokeWidth="1"
      />
      {/* Dome Drum / Windows */}
      <rect
        x="150"
        y="66"
        width="92"
        height="16"
        rx="2"
        fill="#D8F5E3"
        fillOpacity="0.22"
      />
      {[158, 170, 182, 194, 206, 218, 230].map((x) => (
        <rect
          key={x}
          x={x}
          y="70"
          width="5"
          height="9"
          rx="1.5"
          fill="#043B29"
          fillOpacity="0.45"
        />
      ))}
      {/* Main Facade & Colonnade */}
      <rect x="108" y="82" width="168" height="78" fill="#D8F5E3" fillOpacity="0.18" />
      <rect x="132" y="82" width="128" height="8" fill="#FFFFFF" fillOpacity="0.24" />
      {/* Columns */}
      {[138, 152, 166, 180, 194, 208, 222, 236, 250].map((x) => (
        <rect
          key={x}
          x={x}
          y="92"
          width="6"
          height="48"
          rx="1"
          fill="#ECFDF5"
          fillOpacity="0.24"
        />
      ))}
      {/* Left Wing */}
      <rect x="78" y="102" width="56" height="58" fill="#A7F3D0" fillOpacity="0.14" />
      {/* Foliage silhouette at base */}
      <path
        d="M52 160C58 142 74 136 86 144C95 130 116 128 128 142C140 132 162 135 170 150C184 140 208 140 220 152C232 140 258 138 278 154V160H52Z"
        fill="#043B29"
        fillOpacity="0.5"
      />
    </svg>
  );
}

/**
 * Architectural constituency skyline & greenery silhouette for authentication footer.
 */
export function ConstituencySkylineFooter({ className = 'w-full h-14' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 420 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M0 44C75 30 150 38 225 46C300 54 365 36 420 42V64H0V44Z"
        fill="#E9F3EE"
      />
      {/* Left civic dome building */}
      <rect x="86" y="34" width="66" height="30" fill="#D5E5DC" />
      <path d="M104 34C104 22 111 16 119 16C127 16 134 22 134 34H104Z" fill="#168653" fillOpacity="0.65" />
      <line x1="119" y1="10" x2="119" y2="16" stroke="#06452F" strokeWidth="1.5" />
      <rect x="82" y="24" width="6" height="40" fill="#C4DACD" />
      <rect x="150" y="24" width="6" height="40" fill="#C4DACD" />
      {/* Right civic hall */}
      <rect x="304" y="38" width="58" height="26" fill="#D5E5DC" />
      <path d="M320 38C320 27 326 22 333 22C340 22 346 27 346 38H320Z" fill="#06452F" fillOpacity="0.35" />
      <line x1="333" y1="16" x2="333" y2="22" stroke="#06452F" strokeOpacity="0.5" strokeWidth="1.3" />
      {/* Stylized Trees */}
      <circle cx="34" cy="48" r="11" fill="#168653" fillOpacity="0.55" />
      <circle cx="52" cy="52" r="9" fill="#06452F" fillOpacity="0.45" />
      <circle cx="176" cy="50" r="11" fill="#168653" fillOpacity="0.55" />
      <circle cx="196" cy="53" r="8" fill="#06452F" fillOpacity="0.4" />
      <circle cx="284" cy="51" r="10" fill="#168653" fillOpacity="0.5" />
      <circle cx="386" cy="47" r="12" fill="#168653" fillOpacity="0.55" />
      <circle cx="406" cy="52" r="9" fill="#06452F" fillOpacity="0.45" />
    </svg>
  );
}

/**
 * Crisp multicolor Google "G" mark for the Continue with Google button.
 */
export function GoogleMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}
