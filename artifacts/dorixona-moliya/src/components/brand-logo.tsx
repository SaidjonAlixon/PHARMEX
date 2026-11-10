const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function BrandLogo() {
  return <>
    <img
      className="brand-logo logo-light"
      src={`${basePath}/logo_pharmxs.png`}
      alt="PHARMXS"
      width={1511}
      height={220}
      decoding="async"
    />
    <img
      className="brand-logo logo-dark"
      src={`${basePath}/logo_pharmxs.png`}
      alt=""
      aria-hidden="true"
      width={1511}
      height={220}
      decoding="async"
    />
  </>;
}
