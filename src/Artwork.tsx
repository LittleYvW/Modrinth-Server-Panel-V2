export function Cube({
  className = ''
}: {
  className?: string;
}) {
  return <svg className={className} viewBox="0 0 40 44" fill="none" aria-hidden="true"><path d="M20 3 36 12v20L20 41 4 32V12Z" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeWidth="2.6" /><path d="m4 12 16 9 16-9M20 21v20" stroke="currentColor" strokeWidth="2.6" /><path d="m25 19 7-4v8l-7 4Z" fill="currentColor" /></svg>;
}
export function GrassBlock() {
  return <svg className="grass-block" viewBox="0 0 60 64" aria-hidden="true"><defs><pattern id="dirt" width="11" height="13" patternUnits="userSpaceOnUse"><rect width="11" height="13" fill="#976037" /><path d="M0 0h5v5H0zM6 7h5v6H6z" fill="#754728" /><path d="M6 0h5v4H6zM0 8h4v4H0z" fill="#bd8751" /></pattern><pattern id="grass" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="#6fa334" /><path d="M0 0h4v4H0zM5 5h4v4H5z" fill="#89b53b" /></pattern></defs><path d="m3 19 27 13 27-13v31L30 63 3 50Z" fill="url(#dirt)" /><path d="m30 32 27-13v31L30 63Z" fill="#000" opacity=".2" /><path d="M3 19 30 5l27 14-27 14Z" fill="url(#grass)" /><path d="m3 19 27 14 27-14v9l-7 3v5l-7 3v-6l-7 3v5l-6 3-7-4v-5l-7-3v4l-6-3v-7l-7-3Z" fill="#51812e" /></svg>;
}
export function FabricIcon() {
  return <svg className="fabric-icon" viewBox="0 0 58 60" aria-hidden="true"><path d="m28 3 7 6-3 5 18 15 5 1-5 8-7-2-18 21-6-6-7 1-8-9 5-6 19-20-4-5Z" fill="#9b8a70" /><path d="m28 10 7 5-3 4 15 12-8 7-15 16-13-12 18-20-4-5Z" fill="#e6d7b7" /><path d="m14 39 11-12m-9 17 14-14m-8 17 13-14" stroke="#f4e7cb" strokeWidth="2" /><path d="m27 11 7 6m-5 6 15 12" stroke="#655f50" strokeWidth="2" strokeDasharray="3 3" /></svg>;
}
export default function Artwork() {
  return <div className="artwork" aria-hidden="true"><svg className="scene" viewBox="0 0 1672 940" preserveAspectRatio="xMidYMin slice"><defs>
    <radialGradient id="halo"><stop stopColor="#16c66a" stopOpacity=".07" /><stop offset=".77" stopColor="#16c66a" stopOpacity=".015" /><stop offset="1" stopColor="#16c66a" stopOpacity="0" /></radialGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#1a7142" /><stop offset=".48" stopColor="#123d29" /><stop offset="1" stopColor="#17693c" /></linearGradient>
    <linearGradient id="shaft"><stop stopColor="#196c3d" /><stop offset=".5" stopColor="#0b2019" /><stop offset="1" stopColor="#196c3d" /></linearGradient>
    <filter id="texture"><feTurbulence type="fractalNoise" baseFrequency=".65" numOctaves="3" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /><feComponentTransfer><feFuncA type="linear" slope=".11" /></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light" /><feComposite in2="SourceAlpha" operator="in" /></filter>
    <path id="wrench" d="M102 311 201 234Q208 229 219 229H282Q295 229 304 239L398 339Q403 344 418 344H1254Q1269 344 1274 339L1368 239Q1377 229 1390 229H1453Q1464 229 1471 234L1570 311Q1574 316 1565 316H1440L1399 357V437L1440 470H1565Q1574 470 1570 476L1471 550Q1464 556 1453 556H1390Q1377 556 1368 546L1274 451Q1269 446 1254 446H418Q403 446 398 451L304 546Q295 556 282 556H219Q208 556 201 550L102 476Q98 470 107 470H233L273 437V357L233 316H107Q98 316 102 311Z" />
  </defs>
  <circle cx="836" cy="339" r="550" fill="url(#halo)" />
  <g fill="none" stroke="#1a332b" strokeWidth="1"><path d="M134 0v122h41v83L35 345H0M1546 0v122h-47v83l91 94h82M0 445h159v255l51 52h276M1672 445h-158v85l-145 133v142h-77v135M0 568l122 126v56l92 81v109M36 698v211h130M1672 700h-174l-67 65v175M1292 849h171v-70l80-80" /></g>
  <g fill="none" stroke="#21d16c"><circle cx="836" cy="336" r="428" strokeWidth="15" opacity=".23" strokeDasharray="270 14 85 22 150 18" /><circle cx="836" cy="336" r="437" strokeWidth="5" opacity=".42" strokeDasharray="110 12 19 6 70 145" /><circle cx="836" cy="336" r="407" strokeWidth="3" opacity=".2" strokeDasharray="185 54 27 17" /><circle cx="836" cy="336" r="380" strokeWidth="4" opacity=".28" strokeDasharray="62 16 37 440" /><circle cx="836" cy="336" r="451" strokeWidth="7" opacity=".15" strokeDasharray="28 12 8 290" /></g>
  <g fill="#279c61" opacity=".18"><path d="M1130 112h117v6h-117zM1167 132h128v7h-128zM1100 173h138v7h-138zM1180 244h101v8h-101zM362 247h103v7H362zM383 317h96v8h-96zM200 412h73v6h-73z" /></g>
  <use href="#wrench" fill="url(#metal)" stroke="#2ea662" strokeWidth="1.5" filter="url(#texture)" />
  <path d="m441 354 31 35v22l-31 27h790l-31-27v-22l31-35Z" fill="url(#shaft)" stroke="#278753" />
  <g fill="none" stroke="#092b1c" strokeWidth="3"><path d="m177 280 25-25h67l66 70h28l28 28M176 505l26 25h67l77-86h39M1495 280l-25-25h-67l-66 70h-28l-28 28M1496 505l-26 25h-67l-77-86h-39M481 363h104l20 19h462l20-19h104M481 429h710" /></g>
  <g fill="#0b3321" stroke="#26784a"><path d="M154 286h18v18h-18zM326 344h21v22h-21zM347 366h21v21h-21zM327 388h19v20h-19zM154 480h18v18h-18zM172 498h19v20h-19zM552 387h18v19h-18zM1470 286h16v16h-16zM1498 286h19v28h-19zM1301 381h19v19h-19zM1320 400h18v20h-18zM1338 420h19v19h-19zM1500 482h18v18h-18zM1102 387h18v19h-18z" /></g>
  <g fill="#74988a" opacity=".10">{Array.from({
          length: 34
        }, (_, i) => {
          const x = i % 2 === 0 ? 250 + i * 47 % 300 : 1130 + i * 37 % 430;
          const y = 144 + i * 83 % 592;
          return <rect key={i} x={x} y={y} width={18 + i % 12} height={18 + i % 12} />;
        })}</g>
  <g fill="#84938f" opacity=".3"><path d="M1582 103h13v14h-13zM1595 117h14v14h-14zM1582 131h13v14h-13zM61 767h11v11H61zM83 767h11v11H83zM72 778h11v12H72zM61 790h11v11H61zM83 790h11v11H83zM1586 793h13v13h-13zM1599 780h13v13h-13z" /></g>
  </svg><div className="edge-copy top-left">BUILD<br />BETTER<br />TOGETHER</div><div className="edge-copy top-right">MODS<br />POWER<br />COMMUNITY</div><div className="edge-copy bottom-left">SAME<br />GAME<br />BIGGER<br />POSSIBILITIES</div><div className="edge-copy bottom-right">SERVERS<br />MODS<br />PEOPLE</div></div>;
}
