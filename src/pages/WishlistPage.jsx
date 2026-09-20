import ProductCard from '../components/ProductCard';
import { useApp } from '../context/AppContext';
export default function WishlistPage(){
 const { wishlist, navigate, products }=useApp(); const items=products.filter(p=>wishlist.includes(p.id));
 return <main className="pt-[var(--site-header-h,68px)] min-h-screen"><section className="px-6 lg:px-12 py-16 max-w-screen-2xl mx-auto"><h1 className="font-display font-black text-5xl uppercase mb-12">Wishlist</h1>{items.length?<div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-12">{items.map(p=><ProductCard key={p.id} product={p}/>)}</div>:<div className="py-24 text-center border border-border"><p className="text-muted mb-7">Your wishlist is empty.</p><button onClick={()=>navigate('shop')} className="btn-primary px-8 py-4 uppercase text-xs tracking-widest">Explore products</button></div>}</section></main>
}
