import { AzurifyLogo } from './AzurifyLogo';

export const BRAND_SITE_URL = 'https://azurify.win';

// "AZURIFY by DeZio" credit that links back to the AZURIFY website.
export function BrandBadge() {
  return (
    <a
      className="az-brand-badge"
      href={BRAND_SITE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="AZURIFY by DeZio, azurify.win"
    >
      <AzurifyLogo size={16} />
      <span>
        <b>AZURIFY</b> <em>by DeZio</em>
      </span>
      <span className="az-brand-site">azurify.win ↗</span>
    </a>
  );
}
