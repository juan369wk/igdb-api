export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { query } = req.query;
    if (!query) {
        return res.status(400).json({ error: 'Falta el parámetro query' });
    }

    // Evita romper la consulta de IGDB con comillas, barras o asteriscos
    const cleanQuery = String(query).replace(/["\\*]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanQuery) {
        return res.status(400).json({ error: 'Query no válida' });
    }

    try {
        const tokenRes = await fetch(
            `https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
            { method: 'POST' }
        );
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        if (!accessToken) {
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { query } = req.query;
    if (!query) {
        return res.status(400).json({ error: 'Falta el parámetro query' });
    }

    // Evita romper la consulta de IGDB con comillas, barras o asteriscos
    const cleanQuery = String(query).replace(/["\\*]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanQuery) {
        return res.status(400).json({ error: 'Query no válida' });
    }

    try {
        const tokenRes = await fetch(
            `https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
            { method: 'POST' }
        );
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        if (!accessToken) {
            return res.status(500).json({ error: 'No se pudo autenticar con IGDB' });
        }

        const fields = 'name, cover.url, platforms.name, first_release_date, total_rating_count, hypes, game_type, version_parent';

        // Lanza una consulta a IGDB. Si falla, devuelve [] y el motivo (no rompe las demás)
        const runQuery = async (label, body) => {
            try {
                const r = await fetch('https://api.igdb.com/v4/games', {
                    method: 'POST',
                    headers: {
                        'Client-ID': process.env.IGDB_CLIENT_ID,
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'text/plain',
                    },
                    body
                });
                const data = await r.json();
                if (!r.ok || !Array.isArray(data)) {
                    return { label, games: [], error: `HTTP ${r.status}: ${JSON.stringify(data).slice(0, 200)}` };
                }
                return { label, games: data, error: null };
            } catch (e) {
                return { label, games: [], error: String(e) };
            }
        };

        // Palabras para buscar por nombre: hasta 3 (las más largas), "pokemon" -> "pok" para ignorar tildes
        const nameWords = [...new Set(
            cleanQuery.split(' ').filter(w => w.length >= 3).map(w => {
                const lw = w.toLowerCase();
                if (/^pok[eé]mon$/.test(lw)) return 'pok';
                return lw.length > 4 ? lw.replace(/s$/, '') : lw;
            })
        )].sort((a, b) => b.length - a.length).slice(0, 3);

        const jobs = [
            // 1) Búsqueda normal de IGDB (encuentra juegos raros)
            runQuery('buscar', `search "${cleanQuery}"; fields ${fields}; limit 50;`),
            // 2) Búsqueda solo entre juegos con valoraciones (encuentra los populares)
            runQuery('populares', `search "${cleanQuery}"; fields ${fields}; where total_rating_count > 0; limit 100;`),
        ];
        if (nameWords.length) {
            const cond = nameWords.map(w => `name ~ *"${w}"*`).join(' & ');
            // 3) Por nombre, palabra por palabra (encuentra lo que el buscador de IGDB no devuelve)
            jobs.push(runQuery('nombre', `fields ${fields}; where ${cond}; limit 50;`));
        }

        const results = await Promise.all(jobs);

        // Juntar resultados sin duplicados
        const merged = new Map();
        results.forEach(r => {
            r.games.forEach(g => {
                if (g && g.id && g.name && !merged.has(g.id)) merged.set(g.id, g);
            });
        });

        // Si fallaron todas las consultas, avisar en vez de devolver una lista vacía
        if (results.every(r => r.error)) {
            console.error('Todas las consultas a IGDB fallaron:', results.map(r => r.error));
            if (req.query.debug) {
                return res.status(502).json(results.map(r => ({ consulta: r.label, error: r.error })));
            }
            return res.status(502).json({ error: 'Respuesta inválida de IGDB' });
        }

        // Tipos que no queremos: 1 DLC, 2 expansión, 3 bundle, 6 episodio, 7 temporada, 13 pack, 14 update
        const EXCLUDED_TYPES = [1, 2, 3, 6, 7, 13, 14];

        const candidates = [...merged.values()].filter(
            g => !g.version_parent && !EXCLUDED_TYPES.includes(g.game_type)
        );

        // Minúsculas y sin tildes para comparar
        const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const q = normalize(cleanQuery);
        // Quita la "s" final para que survivor/survivors cuenten igual
        const words = q.split(' ').filter(Boolean).map(w => (w.length > 4 ? w.replace(/s$/, '') : w));
        const popularity = g => (g.total_rating_count || 0) + (g.hypes || 0);

        // 2 = coincidencia exacta, 1 = contiene todas las palabras buscadas, 0 = el resto
        const tier = g => {
            const n = normalize(g.name);
            if (n === q) return 2;
            if (words.every(w => n.includes(w))) return 1;
            return 0;
        };

        candidates.sort((a, b) => tier(b) - tier(a) || popularity(b) - popularity(a));

        // Diagnóstico: /api/search-game?query=...&debug=1
        if (req.query.debug) {
            return res.status(200).json({
                consultas: results.map(r => ({ consulta: r.label, total: r.games.length, error: r.error })),
                juegos: candidates.slice(0, 40).map(g => `${g.name} [tipo ${g.game_type}] pop=${popularity(g)}`)
            });
        }

        const formattedGames = candidates.slice(0, 15).map(game => {
            let year = '';
            if (game.first_release_date) {
                const extracted = new Date(game.first_release_date * 1000).getFullYear();
                if (!isNaN(extracted)) {
                    year = extracted;
                }
            }

            return {
                id: game.id,
                name: game.name,
                cover: game.cover && game.cover.url
                    ? `https:${game.cover.url.replace('t_thumb', 't_720p')}`
                    : 'https://via.placeholder.com/264x352?text=Sin+Imagen',
                platforms: game.platforms ? game.platforms.map(p => p.name) : [],
                first_release_date: year
            };
        });

        return res.status(200).json(formattedGames);

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error al conectar con la API de IGDB' });
    }
}
