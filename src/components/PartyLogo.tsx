import { useEffect, useState } from 'react';
import {
  extractPartyLogoAssetId,
  hasConfiguredPartyLogo,
  resolvePartyLogoDisplayUrl,
} from '../services/partyService';
import { FIXED_PARTY_MAP, type PartyCode, type PartyConfig } from '../types/fdmis';

interface PartyLogoProps {
  partyCode: PartyCode;
  partyConfig?: PartyConfig | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<PartyLogoProps['size']>, string> = {
  xs: 'h-6 w-6 text-[9px] rounded',
  sm: 'h-8 w-8 text-[10px] rounded-md',
  md: 'h-10 w-10 text-xs rounded-lg',
  lg: 'h-14 w-14 text-sm rounded-lg',
  xl: 'h-20 w-20 text-base rounded-xl',
};

export function PartyLogo({
  partyCode,
  partyConfig,
  size = 'md',
  className = '',
}: PartyLogoProps) {
  const hasLogo = hasConfiguredPartyLogo(partyConfig);
  const logoUrl = partyConfig?.logoUrl || '';
  const assetId = extractPartyLogoAssetId(partyConfig) || '';
  const sha256Hash = partyConfig?.sha256Hash || '';
  const storageMode = partyConfig?.storageMode || 'none';

  const isDirectUrl =
    hasLogo && (logoUrl.startsWith('https://') || logoUrl.startsWith('data:image/'));

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(isDirectUrl ? logoUrl : null);
  const [imgError, setImgError] = useState(false);
  const [retriedFromServer, setRetriedFromServer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImgError(false);
    setRetriedFromServer(false);

    if (!hasLogo || !partyConfig) {
      setResolvedUrl(null);
      return;
    }

    if (isDirectUrl) {
      setResolvedUrl(logoUrl);
      return;
    }

    void resolvePartyLogoDisplayUrl(partyConfig).then((url) => {
      if (!cancelled) {
        setResolvedUrl(url);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [hasLogo, isDirectUrl, logoUrl, assetId, sha256Hash, storageMode, partyConfig]);

  const handleImageError = () => {
    if (!retriedFromServer && partyConfig && hasLogo && !isDirectUrl) {
      setRetriedFromServer(true);
      void resolvePartyLogoDisplayUrl(partyConfig, { forceServer: true }).then((freshUrl) => {
        if (freshUrl) {
          setResolvedUrl(freshUrl);
          setImgError(false);
        } else {
          setImgError(true);
        }
      });
      return;
    }
    setImgError(true);
  };

  const meta = FIXED_PARTY_MAP[partyCode];
  const sizeClass = SIZE_CLASSES[size];

  if (resolvedUrl && !imgError) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden border border-slate-200 bg-white p-0.5 ${sizeClass} ${className}`}
      >
        <img
          src={resolvedUrl}
          alt={`${partyCode} — ${meta.name} logo`}
          onError={handleImageError}
          className="h-full w-full object-contain"
        />
      </div>
    );
  }

  return (
    <div
      title={`${partyCode} — ${meta.name} (no custom logo uploaded)`}
      className={`flex shrink-0 items-center justify-center border font-mono font-bold tracking-tight ${meta.badgeClass} ${sizeClass} ${className}`}
    >
      {partyCode === 'OTHERS' ? 'OTH' : partyCode}
    </div>
  );
}
