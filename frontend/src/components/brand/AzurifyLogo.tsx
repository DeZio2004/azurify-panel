import { useId } from 'react';

interface AzurifyLogoProps {
  size?: number;
  className?: string;
}

export function AzurifyLogo({ size = 28, className }: AzurifyLogoProps) {
  const gradientId = useId();
  return (
    <svg
      className={className}
      width={size}
      height={size * 0.83}
      viewBox="0 0 940 780"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0.7" y1="0" x2="0.25" y2="1">
          <stop offset="0" stopColor="#00f0d0" />
          <stop offset="0.55" stopColor="#00b4e6" />
          <stop offset="1" stopColor="#0068d0" />
        </linearGradient>
      </defs>
      <g fill={`url(#${gradientId})`}>
        <path d="M500 18 L938 765 H730 L493 357 L235 765 H28 Z" />
        <path d="M494 460 L548 545 L293 770 Z" />
        <path d="M497 598 L549 553 L678 758 Z" />
        <path d="M492 600 L548 653 L293 770 Z" />
      </g>
    </svg>
  );
}
