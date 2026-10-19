import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListCatalogAdminDto } from './catalog.dto';

describe('ListCatalogAdminDto sort', () => {
  const check = (input: Record<string, unknown>) =>
    validate(plainToInstance(ListCatalogAdminDto, input));

  it.each(['name_asc', 'name_desc', 'created_desc', 'created_asc'])(
    'accepts %s',
    async (sort) => {
      expect(await check({ sort })).toHaveLength(0);
    }
  );

  it('accepts a missing sort', async () => {
    expect(await check({})).toHaveLength(0);
  });

  it('rejects an unknown sort value', async () => {
    const errors = await check({ sort: 'price_asc' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('sort');
  });
});
