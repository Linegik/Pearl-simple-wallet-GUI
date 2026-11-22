import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeBoxProps {
  value: string;
  size?: number;
  label: string;
}

export function QrCodeBox({ value, size = 180, label }: QrCodeBoxProps) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    if (!value) {
      setDataUrl('');
      return;
    }
    QRCode.toDataURL(value, {
      width: size,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-500"
      >
        Нет данных QR
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-center rounded-lg border border-slate-200 bg-white p-2">
      <img
        src={dataUrl}
        alt={label}
        width={size}
        height={size}
        className="block rounded"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
