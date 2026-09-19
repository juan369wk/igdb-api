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

    // Evita romper la consulta de IGDB con comillas o barras
    const cleanQuery = String(query).replace(/["\\]/g, ' ').trim();
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

        // game_type: 0 juego base, 4 standalone, 5 mod/fangame, 8 remake, 9 remaster, 10 expanded, 11 port, 12 fork
        // version_parent = null descarta ediciones/versiones duplicadas
        // Se piden 50 para poder reordenar por popularidad (IGDB no permite sort junto a search)
        const igdbRes = await fetch('https://api.igdb.com/v4/games', {
            method: 'POST',
            headers: {
                'Client-ID': process.env.IGDB_CLIENT_ID,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'text/plain',
            },
            body: `search "${cleanQuery}"; fields name, cover.url, platforms.name, first_release_date, total_rating_count, hypes; where version_parent = null & game_type = (0,4,5,8,9,10,11,12); limit 50;`
        });

        const games = await igdbRes.json();

        if (!igdbRes.ok || !Array.isArray(games)) {
            console.error('Respuesta inesperada de IGDB:', games);
            return res.status(502).json({ error: 'Respuesta inválida de IGDB' });
        }

        // Minúsculas y sin tildes para comparar
        const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const q = normalize(cleanQuery);
        const words = q.split(/\s+/).filter(Boolean);
        const popularity = g => (g.total_rating_count || 0) + (g.hypes || 0);

        // 2 = coincidencia exacta, 1 = contiene todas las palabras buscadas, 0 = el resto
        const tier = g => {
            const n = normalize(g.name);
            if (n === q) return 2;
            if (words.every(w => n.includes(w))) return 1;
            return 0;
        };

        const formattedGames = games
            .filter(game => game && game.name)
            .sort((a, b) => tier(b) - tier(a) || popularity(b) - popularity(a))
            .slice(0, 15)
            .map(game => {
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
