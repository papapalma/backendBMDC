import { supabaseAdmin } from '@/lib/supabase-admin';
import { db } from '@/lib/db';
import { Item } from '@/types';
import { CreateItemInput, UpdateItemInput } from '@/utils/validators';
import { deleteImageWithThumbnail, ensureThumbnailForImagePath } from '@/utils/fileUpload';
import { TenantContext } from '@/middleware/tenantContext';

export class ItemService {
  private async withThumbnail(item: Item): Promise<Item> {
    return {
      ...item,
      thumbnail_path: await ensureThumbnailForImagePath(item.image_path ?? null),
    };
  }

  async getAllItems(context: TenantContext | null, filters?: {
    category?: string;
    status?: string;
    search?: string;
  }): Promise<Item[]> {
    let query = supabaseAdmin.from('items').select('*');

    // Apply tenant filtering for non-super-admin users

if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

if (filters?.category) {
      query = query.eq('category', filters.category);
    }

if (filters?.status) {
      query = query.eq('status', filters.status);
    }

if (filters?.search) {
      query = query.or(`name.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
    }
    
    query = query.order('created_at', { ascending: false });
    
    const { data, error } = await query;
    
    if (error) throw error;

    const items = data || [];
    return Promise.all(items.map((item) => this.withThumbnail(item as Item)));
  }

  async getItemById(context: TenantContext | null, id: string): Promise<Item | null> {
    let query = supabaseAdmin.from('items').select('*').eq('id', id);

    // Apply tenant filtering for non-super-admin users

if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

const { data, error } = await query.maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;

    if (!data) {
      return null;
    }

    return this.withThumbnail(data as Item);
  }

  async createItem(itemData: CreateItemInput, userId: string, tenantId?: string): Promise<Item> {
    // Embed tenant_id in QR code for tenant-scoped asset tracking (Req 8.5, 17.5)

const tenantPrefix = tenantId ? tenantId.replace(/-/g, '').substring(0, 8).toUpperCase() : 'GLOBAL';
    const qrCode = `ITEM-${tenantPrefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const newItem: Record<string, unknown> = {
      ...itemData,
      qr_code: qrCode,
      available_quantity: itemData.quantity,
      status: this.calculateItemStatus(itemData.quantity, itemData.minimum_quantity || 10),
      created_by: userId,
      // Map camelCase tenantId → snake_case tenant_id for DB (Req 8.1)
      ...(tenantId ? { tenant_id: tenantId } : {}),
    };
    
    // Use supabaseAdmin to bypass RLS policies

const { data, error } = await supabaseAdmin
      .from('items')
      .insert(newItem)
      .select()
      .single();
    
    if (error) throw error;
    return this.withThumbnail(data);
  }

  async updateItem(id: string, itemData: UpdateItemInput): Promise<Item> {
    const existingItem = await this.getItemById(null, id);
    if (!existingItem) {
      throw new Error('Item not found');
    }

const updateData: any = { ...itemData };
    
    if (itemData.quantity !== undefined) {
      updateData.status = this.calculateItemStatus(
        itemData.quantity,
        itemData.minimum_quantity || existingItem.minimum_quantity
      );
    }

const imageWasUpdated = Object.prototype.hasOwnProperty.call(itemData, 'image_path');
    const updatedItem = await db.update<Item>('items', id, updateData);

    if (
      imageWasUpdated &&
      existingItem.image_path &&
      itemData.image_path !== existingItem.image_path
    ) {
      await deleteImageWithThumbnail(existingItem.image_path);
    }

    return this.withThumbnail(updatedItem);
  }

  async deleteItem(id: string): Promise<void> {
    const existingItem = await this.getItemById(null, id);
    await db.delete('items', id);

    if (existingItem?.image_path) {
      await deleteImageWithThumbnail(existingItem.image_path);
    }
  }

  async updateItemQuantity(
    itemId: string,
    quantityChange: number,
    type: 'borrow' | 'return'
  ): Promise<Item> {
    const item = await this.getItemById(null, itemId);
    if (!item) {
      throw new Error('Item not found');
    }

const newAvailableQuantity = type === 'borrow' 
      ? item.available_quantity - quantityChange
      : item.available_quantity + quantityChange;
    
    if (newAvailableQuantity < 0) {
      throw new Error('Insufficient quantity available');
    }

if (newAvailableQuantity > item.quantity) {
      throw new Error('Return quantity exceeds borrowed quantity');
    }

const status = this.calculateItemStatus(newAvailableQuantity, item.minimum_quantity);
    
    const updatedItem = await db.update<Item>('items', itemId, {
      available_quantity: newAvailableQuantity,
      status,
    });

    return this.withThumbnail(updatedItem);
  }

  private calculateItemStatus(
    quantity: number,
    minimumQuantity: number
  ): 'available' | 'low_stock' | 'out_of_stock' {
    if (quantity === 0) return 'out_of_stock';
    if (quantity <= minimumQuantity) return 'low_stock';
    return 'available';
  }

  async getItemByQRCode(context: TenantContext | null, qrCode: string): Promise<Item | null> {
    let query = supabaseAdmin
      .from('items')
      .select('*')
      .eq('qr_code', qrCode);

    // Apply tenant filtering for non-super-admin users

if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

const { data, error } = await query.maybeSingle();
    
    if (error && error.code !== 'PGRST116') throw error;

    if (!data) {
      return null;
    }

    return this.withThumbnail(data as Item);
  }
}

export const itemService = new ItemService();
