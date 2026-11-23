import { Cpu } from 'lucide-react';
import { useState } from 'react';

interface EquipmentImageProps {
  src: string;
  alt: string;
  title: string;
  className?: string;
}

export function isSafeImageUrl(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function EquipmentImage({ src, alt, title, className = '' }: EquipmentImageProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError || !isSafeImageUrl(src)) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-slate-100 text-slate-500 p-4 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <Cpu className="w-8 h-8 text-slate-400 mb-2" aria-hidden="true" />
        <span className="text-xs font-medium text-slate-600 line-clamp-2">{title}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={`object-cover bg-slate-100 ${className}`}
    />
  );
}
