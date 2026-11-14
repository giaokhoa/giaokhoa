import { Client } from 'pg';

export async function seedLegacyCentreInShared(input: { slug: string; name: string }): Promise<string> {
  const client = new Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    await client.query("SELECT set_config('app.platform', 'on', false)");
    const result = await client.query<{ id: string }>(
      "INSERT INTO tenants (slug, name, kind, status) VALUES ($1, $2, 'center', 'active') RETURNING id",
      [input.slug, input.name],
    );
    return result.rows[0]!.id;
  } finally {
    await client.end();
  }
}
