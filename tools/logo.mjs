// Headline Watch mark: Playfair Display ExtraBold "H" (the masthead face, OFL) + vermilion period.
export const H='M457 0V20Q488 22 503.5 28Q519 34 524.5 52Q530 70 530 106V602Q530 639 524.5 656.5Q519 674 503.5 680.5Q488 687 457 688V708Q486 707 532 706Q578 705 624 705Q673 705 715.5 706Q758 707 784 708V688Q753 687 737 680.5Q721 674 716 656.5Q711 639 711 602V106Q711 70 716.5 52Q722 34 737.5 28Q753 22 784 20V0Q758 2 715.5 2.5Q673 3 624 3Q578 3 532 2.5Q486 2 457 0ZM31 0V20Q62 22 77.5 28Q93 34 98.5 52Q104 70 104 106V602Q104 639 98.5 656.5Q93 674 77.5 680.5Q62 687 31 688V708Q58 707 103 706Q148 705 199 705Q243 705 286.5 706Q330 707 358 708V688Q327 687 311 680.5Q295 674 290 656.5Q285 639 285 602V106Q285 70 290.5 52Q296 34 311.5 28Q327 22 358 20V0Q330 2 286.5 2.5Q243 3 199 3Q148 3 103 2.5Q58 2 31 0Z';
export const P='#f5f0e6',I='#1a1714',R='#c8371d',RD='#ff6b4a';
const n=(v)=>+v.toFixed(2);
// inner(): mark drawn in a 512 box. small=true is the optical size for 16-32px.
export function inner({fg=I,red=R,small=false}={}){
  const cap=small?272:262, s=cap/708, d=small?100:76, gap=small?24:20;
  const w=753*s+gap+d, x0=(512-w)/2-(small?0:5)-31*s, base=256+cap/2;
  const bar=small?[322,390]:[343,369]; // crossbar in font units (hairline is 346-366)
  const sw=small?26:0;
  return `<g transform="translate(${n(x0)} ${n(base)}) scale(${n(s)} ${n(-s)})" fill="${fg}"><path d="${H}"${sw?` stroke="${fg}" stroke-width="${sw}" stroke-linejoin="round"`:''}/><path d="M250 ${bar[0]}H565V${bar[1]}H250Z"/></g><circle cx="${n(x0+784*s+gap+d/2)}" cy="${n(base-d/2+(small?2:1))}" r="${d/2}" fill="${red}"/>`;
}
export function svg({bg=P,fg=I,red=R,small=false,rx=114,scale=1,size=null}={}){
  const g=scale===1?inner({fg,red,small}):`<g transform="translate(${n(256*(1-scale))} ${n(256*(1-scale))}) scale(${scale})">${inner({fg,red,small})}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"${size?` width="${size}" height="${size}"`:''}>${bg?`<rect width="512" height="512" rx="${rx}" fill="${bg}"/>`:''}${g}</svg>`;
}
