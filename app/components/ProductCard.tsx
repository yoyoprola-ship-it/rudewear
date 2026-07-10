'use client';
import Link from 'next/link';
import { SIZES, type Product, totalStock } from '@/app/types';

// Card del grid — imagen, nombre, categoría + tallas en una línea,
// precio. El chip de talla se muestra ATENUADO si esa talla está
// sin stock.

interface ProductCardProps {
  product: Product;
  /** Nombre de la categoría — la resolvés en el padre a partir de
   *  product.categoryId (evita un fetch por card). Opcional; si falta
   *  no se renderiza el label. */
  categoryName?: string;
}

export default function ProductCard({ product, categoryName }: ProductCardProps) {
  const cover = product.images?.[0];
  const stock = totalStock(product);
  const soldOut = stock === 0;

  return (
    <Link
      href={`/product/${product.id}`}
      className="group block bg-neutral-950 border border-neutral-900 hover:border-neutral-700 rounded overflow-hidden transition-colors"
    >
      {/* Image — object-contain para NUNCA cropear. Ratio del contenedor
          matchea 2000x2500 (4:5); imágenes con otra ratio muestran
          letterboxing gris. La prenda completa siempre visible. */}
      <div className="relative aspect-[4/5] bg-neutral-900 overflow-hidden">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={product.name}
            className={`w-full h-full object-contain transition-transform duration-500 group-hover:scale-105 ${
              soldOut ? 'grayscale opacity-60' : ''
            }`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-700 text-xs uppercase font-bold">
            No image
          </div>
        )}
        {soldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <span className="bg-red-600 text-white text-xs font-black uppercase tracking-wider px-3 py-1 rounded">
              Sold out
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-sm font-bold text-white line-clamp-2 min-h-[2.6rem]">
          {product.name}
        </p>

        {/* Categoría (izquierda) + tallas disponibles (derecha) en 1 línea.
            Category trunca si es larga; sizes flex-shrink-0 no se aplasta. */}
        <div className="flex items-center justify-between gap-2 my-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 truncate">
            {categoryName || '—'}
          </span>
          <div className="flex gap-0.5 flex-shrink-0">
            {SIZES.filter((s) => (product.sizes || []).includes(s)).map((s) => {
              const stockOfSize = product.stockBySize?.[s] ?? 0;
              const outOfSize = stockOfSize <= 0;
              return (
                <span
                  key={s}
                  className={`text-[9px] font-bold uppercase px-1 py-px rounded border ${
                    outOfSize
                      ? 'border-neutral-800 text-neutral-700 line-through'
                      : 'border-neutral-700 text-neutral-300'
                  }`}
                  title={outOfSize ? `${s} out of stock` : `${s} in stock`}
                >
                  {s}
                </span>
              );
            })}
          </div>
        </div>

        <p className="text-lg font-black text-white">
          ${product.sellPrice.toFixed(2)}
        </p>
      </div>
    </Link>
  );
}
