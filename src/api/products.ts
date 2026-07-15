// src/api/products.ts — product image upload, used both on the Products
// page and the image-based picker in the warehouse daily log.
import { supabase } from '../lib/supabase'

const BUCKET = 'product-images'

export async function uploadProductImage(productId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${productId}/${Date.now()}.${ext}`

  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (upError) throw new Error(upError.message)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)

  const { error: updateError } = await supabase
    .from('products')
    .update({ image_url: data.publicUrl })
    .eq('id', productId)
  if (updateError) throw new Error(updateError.message)

  return data.publicUrl
}

export async function fetchProductsWithImages() {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku, image_url, is_active')
    .eq('is_active', true)
    .order('name')
  if (error) throw new Error(error.message)
  return data
}
