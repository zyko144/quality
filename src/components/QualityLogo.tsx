import type { ImgHTMLAttributes } from 'react';
import logoUrl from '@/assets/quality_logo.png';

interface QualityLogoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  size?: number;
  className?: string;
}

export function QualityLogo({ size = 24, className = '', style, alt = 'Echow', ...props }: QualityLogoProps) {
  return (
    <img
      src={logoUrl}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        objectFit: 'contain',
        ...style,
      }}
      {...props}
    />
  );
}

export const EchowLogo = QualityLogo;
