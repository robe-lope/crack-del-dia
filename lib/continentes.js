// Continente según el código de país (ISO 3166-1 alfa-2 en minúscula; las selecciones británicas llevan gb-xxx).
const LISTAS = {
  europa: 'ad al am at ax az ba be bg by ch cy cz de dk ee es fi fo fr gb gb-eng gb-nir gb-sct gb-wls ge gg gi gr hr hu ie im is it je kz li lt lu lv mc md me mk mt nl no pl pt ro rs ru se si sk sm tr ua va xk',
  sudamerica: 'ar bo br cl co ec gf gy pe py sr uy ve',
  norteamerica: 'ag ai aw bb bm bs bz ca cr cu cw dm do gd gp gt hn ht jm kn ky lc mq ms mx ni pa pr sv tt us vc vg vi',
  africa: 'ao bf bi bj bw cd cf cg ci cm cv dj dz eg er et ga gh gm gn gq gw ke km lr ls ly ma mg ml mr mu mw mz na ne ng rw sd sl sn so ss st sz tg tn tz ug za zm zw',
  asia: 'ae af bd bh bn bt cn hk id il in iq ir jo jp kg kh kp kr kw la lb lk mm mn mo my np om ph pk ps qa sa sg sy th tj tm tw uz vn ye',
  oceania: 'au fj fm nc nz pg ws sb to vu',
};

const POR_CODIGO = new Map();
for (const [continente, lista] of Object.entries(LISTAS)) for (const c of lista.split(' ')) POR_CODIGO.set(c, continente);

export const continenteDe = (codigo) => POR_CODIGO.get(String(codigo ?? '').toLowerCase()) ?? null;
