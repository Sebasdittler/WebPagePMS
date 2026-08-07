// Genera /sitemap.xml al vuelo consultando Firestore, para que las
// propiedades nuevas (cargadas desde Fang con "Mostrar en la web" activo)
// aparezcan automáticamente sin tocar nada ni redeployar.
//
// Usa la misma API key pública que ya está embebida en index.html (solo
// lectura, ya expuesta al cliente) y el mismo slugify que usa el front —
// si se cambia uno hay que actualizar el otro.

const PROJECT_ID = 'fangpmshagrids';
const API_KEY = 'AIzaSyCl0sGzLLRFB__vU5HUdy4trsRBoHWFJwU';
const BASE_URL = 'https://www.aucen.com.ar';

function slugify(str) {
  return String(str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'propiedad';
}

function unwrap(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.mapValue) { const o = {}; for (const k in (v.mapValue.fields || {})) o[k] = unwrap(v.mapValue.fields[k]); return o; }
  if (v.arrayValue) return (v.arrayValue.values || []).map(unwrap);
  return null;
}

async function cargarPropiedades() {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/sitioWeb_propiedades?key=${API_KEY}&pageSize=300`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Firestore respondió ' + r.status);
  const data = await r.json();
  const docs = data.documents || [];
  return docs
    .map(d => {
      const fields = {};
      for (const k in (d.fields || {})) fields[k] = unwrap(d.fields[k]);
      return { id: d.name.split('/').pop(), ...fields };
    })
    .filter(p => p.mostrarEnWeb === true);
}

function xmlUrl({ loc, lastmod, changefreq, priority }) {
  return `  <url>\n    <loc>${BASE_URL}${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

module.exports = async (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const urls = [xmlUrl({ loc: '/', lastmod: hoy, changefreq: 'weekly', priority: '1.0' })];

  try {
    const props = await cargarPropiedades();
    const used = {};
    props.forEach(p => {
      const base = slugify(p.nombre || p.id);
      let slug = base, n = 2;
      while (used[slug]) { slug = base + '-' + n; n++; }
      used[slug] = true;
      const lastmod = (typeof p.updatedAt === 'string' && p.updatedAt.slice(0, 10)) || hoy;
      urls.push(xmlUrl({ loc: '/' + slug, lastmod, changefreq: 'weekly', priority: '0.8' }));
    });
  } catch (e) {
    // Si Firestore falla, igual devolvemos un sitemap válido con la home.
    console.error('sitemap: error consultando Firestore', e);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
};
