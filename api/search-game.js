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

        // Búsqueda ordenada por número de valoraciones/popularidad para priorizar los juegos reales oficiales
        const igdbRes = await fetch('https://api.igdb.com/v4/games', {
            method: 'POST',
            headers: {
                'Client-ID': process.env.IGDB_CLIENT_ID,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'text/plain',
            },
            body: `search "${query}"; fields name, cover.url, platforms.name, first_release_date, total_rating_count; sort total_rating_count desc; limit 15;`
        });

        const games = await igdbRes.json();

        const formattedGames = games.map(game => {
            let year = '';
            if (game.first_release_date) {
                const dateObj = new Date(game.first_release_date * 1000);
                const extracted = dateObj.getFullYear();
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
