const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function BrandLogo() {
  return <>
    <img className="brand-logo logo-light" src={`${basePath}/Phrmexslogo.png`} alt="PHARMEX" width={1585} height={221} />
    <img className="brand-logo logo-dark" src={`${basePath}/Phrmexslogo-dark.png`} alt="" aria-hidden="true" width={1585} height={221} />
  </>;
}
