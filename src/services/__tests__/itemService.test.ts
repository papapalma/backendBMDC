import { ItemService } from '../itemService';
import { db } from '@/lib/db';

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock('@/lib/db', () => ({
  db: {
    update: jest.fn(),
  },
}));

jest.mock('@/utils/fileUpload', () => ({
  ensureThumbnailForImagePath: jest.fn().mockResolvedValue(null),
  deleteImageWithThumbnail: jest.fn().mockResolvedValue(undefined),
}));

describe('ItemService.updateItem', () => {
  let itemService: ItemService;

  beforeEach(() => {
    jest.clearAllMocks();
    itemService = new ItemService();
  });

  it('adjusts available_quantity when total quantity is updated with 0 items borrowed', async () => {
    const existing = {
      id: 'item-1',
      name: 'Drill',
      quantity: 10,
      available_quantity: 10,
      minimum_quantity: 2,
      status: 'available' as const,
      category: 'Tools',
      location: 'Shelf A',
      unit: 'piece(s)',
    };

    jest.spyOn(itemService, 'getItemById').mockResolvedValue(existing as any);
    (db.update as jest.Mock).mockImplementation((_table, _id, updateData) =>
      Promise.resolve({ ...existing, ...updateData })
    );

    const result = await itemService.updateItem('item-1', { quantity: 5 });

    expect(db.update).toHaveBeenCalledWith('items', 'item-1', expect.objectContaining({
      quantity: 5,
      available_quantity: 5,
      status: 'available',
    }));
    expect(result.available_quantity).toBe(5);
  });

  it('adjusts available_quantity preserving active borrowings when total quantity increases', async () => {
    // 10 total, 7 available => 3 borrowed
    const existing = {
      id: 'item-1',
      name: 'Drill',
      quantity: 10,
      available_quantity: 7,
      minimum_quantity: 2,
      status: 'available' as const,
    };

    jest.spyOn(itemService, 'getItemById').mockResolvedValue(existing as any);
    (db.update as jest.Mock).mockImplementation((_table, _id, updateData) =>
      Promise.resolve({ ...existing, ...updateData })
    );

    // Increase total to 15 => new available should be 15 - 3 = 12
    await itemService.updateItem('item-1', { quantity: 15 });

    expect(db.update).toHaveBeenCalledWith('items', 'item-1', expect.objectContaining({
      quantity: 15,
      available_quantity: 12,
    }));
  });

  it('adjusts available_quantity preserving active borrowings when total quantity decreases safely', async () => {
    // 10 total, 7 available => 3 borrowed
    const existing = {
      id: 'item-1',
      name: 'Drill',
      quantity: 10,
      available_quantity: 7,
      minimum_quantity: 5,
      status: 'available' as const,
    };

    jest.spyOn(itemService, 'getItemById').mockResolvedValue(existing as any);
    (db.update as jest.Mock).mockImplementation((_table, _id, updateData) =>
      Promise.resolve({ ...existing, ...updateData })
    );

    // Decrease total to 6 => new available should be 6 - 3 = 3 <= min_qty 5 => 'low_stock'
    await itemService.updateItem('item-1', { quantity: 6 });

    expect(db.update).toHaveBeenCalledWith('items', 'item-1', expect.objectContaining({
      quantity: 6,
      available_quantity: 3,
      status: 'low_stock',
    }));
  });

  it('throws an error if attempting to reduce total quantity below currently borrowed items', async () => {
    // 10 total, 6 available => 4 borrowed
    const existing = {
      id: 'item-1',
      name: 'Drill',
      quantity: 10,
      available_quantity: 6,
      minimum_quantity: 2,
    };

    jest.spyOn(itemService, 'getItemById').mockResolvedValue(existing as any);

    await expect(itemService.updateItem('item-1', { quantity: 3 })).rejects.toThrow(
      'Cannot reduce quantity to 3. There are currently 4 item(s) on loan.'
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it('does not touch available_quantity if quantity is not provided in update payload', async () => {
    const existing = {
      id: 'item-1',
      name: 'Drill',
      quantity: 10,
      available_quantity: 6,
      minimum_quantity: 2,
    };

    jest.spyOn(itemService, 'getItemById').mockResolvedValue(existing as any);
    (db.update as jest.Mock).mockImplementation((_table, _id, updateData) =>
      Promise.resolve({ ...existing, ...updateData })
    );

    await itemService.updateItem('item-1', { name: 'Hammer' });

    expect(db.update).toHaveBeenCalledWith('items', 'item-1', expect.not.objectContaining({
      available_quantity: expect.anything(),
    }));
  });
});
