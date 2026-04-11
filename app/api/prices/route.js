import { NextResponse } from 'next/server';
import { AH } from 'albert-heijn-wrapper';
import translate from 'google-translate-api-x';

export async function POST(request) {
  try {
    const { ingredients } = await request.json();

    if (!ingredients || !Array.isArray(ingredients)) {
      return NextResponse.json({ error: 'Array of ingredients is required.' }, { status: 400 });
    }

    const ah = new AH();
    const results = [];

    for (const item of ingredients) {
      try {
        // Translate english ingredient to dutch
        const translated = await translate(item, { to: 'nl' });
        const searchTerm = translated.text || item;
        
        const searchRes = await ah.product.search(searchTerm);
        const products = searchRes.products;

        if (products && products.length > 0) {
          const prod = products[0];
          results.push({
            query: item,
            title: prod.title,
            price: prod.priceV2?.now || prod.price?.now || 0,
            image: prod.images?.[0]?.url || null,
            unit: prod.salesUnitSize || "",
            link: prod.webPath ? `https://www.ah.nl${prod.webPath}` : null
          });
        } else {
          results.push({ query: item, error: "Not found", price: 0 });
        }
      } catch (e) {
        console.error(`Error searching for ${item}:`, e);
        results.push({ query: item, error: "Search failed", price: 0 });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
