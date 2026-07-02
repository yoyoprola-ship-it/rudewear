'use client';
import Link from 'next/link';
import { SIZES, type Product, totalStock } from '@/app/types';

// Card del grid — imagen, nombre, precio, chips de tallas disponibles.
// El chip de talla se muestra ATENUADO si esa talla está sin stock.

export default function ProductCard({ product }: { product: Product }) {
  const cover = product.images?.[0];
  const stock = totalStock(product);
  const soldOut = stock === 0;

  return (
    <Link
      href={`/product/${product.id}`}
      className="group block bg-neutral-950 border border-neutral-900 hover:border-neutral-700 rounded overflow-hidden transition-colors"
    >
      {/* Image */}
      <div className="relative aspect-[4/5] bg-neutral-900 overflow-hidden">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={product.name}
            className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${
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

        {/* Size chips — solo las que tiene disponibles */}
        <div className="flex flex-wrap gap-1 my-2">
          {SIZES.filter((s) => (product.sizes || []).includes(s)).map((s) => {
            const stockOfSize = product.stockBySize?.[s] ?? 0;
            const outOfSize = stockOfSize <= 0;
            return (
              <span
                key={s}
                className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${
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

        <p className="text-lg font-black text-white">
          ${product.sellPrice.toFixed(2)}
        </p>
      </div>
    </Link>
  );
}
