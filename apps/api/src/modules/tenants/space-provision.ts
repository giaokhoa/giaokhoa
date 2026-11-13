import { PUBLIC_LEARNING_SLUG } from './public-learning';
import { installSpaceRoleBaseline, manageCentreInvite, runSpaceProvision } from './space-provision-runner';

function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument ${arg} (expected --key value)`);
    const key = arg.slice(2);
    if (!key) throw new Error('Empty -- flag');
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function required(args: Record<string, string | true>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value) throw new Error(`Missing required --${key}`);
  return value;
}

function optional(args: Record<string, string | true>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

const USAGE = `Usage:
  node dist/modules/tenants/space-provision.js provision --slug <slug> --name <name> --admin-email <email> --actor-id <uuid> [--plan <plan>] [--admin-username <username>] [--admin-first-name <name>] [--admin-last-name <name>] [--database-name <db>] [--database-password <password>]
  node dist/modules/tenants/space-provision.js provision-public --admin-email <email> --actor-id <uuid> [--admin-username <username>] [--database-password <password>]
  node dist/modules/tenants/space-provision.js invite --slug <slug> --email <email> [--revoke]
  node dist/modules/tenants/space-provision.js install-roles --slug <slug>`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === 'provision' || command === 'provision-public') {
    const result = await runSpaceProvision({
      slug: command === 'provision-public' ? PUBLIC_LEARNING_SLUG : required(args, 'slug'),
      name: command === 'provision-public' ? 'Khu học tập công cộng' : required(args, 'name'),
      ...(command === 'provision-public' ? { kind: 'platform' as const } : {}),
      plan: optional(args, 'plan'),
      adminUsername: optional(args, 'admin-username'),
      adminEmail: required(args, 'admin-email'),
      adminFirstName: optional(args, 'admin-first-name'),
      adminLastName: optional(args, 'admin-last-name'),
      databaseName: optional(args, 'database-name'),
      databasePassword: optional(args, 'database-password'),
      actorId: required(args, 'actor-id'),
    });
    console.log(`PROVISION_RESULT ${JSON.stringify({
      slug: result.slug,
      spaceId: result.spaceId,
      databaseName: result.databaseName,
      connectionRole: result.connectionRole,
      secretEnvVar: result.secretEnvVar,
      tenantId: result.tenantId,
      adminUserId: result.adminUserId,
      inviteToken: result.inviteToken,
      inviteExpiresAt: result.inviteExpiresAt?.toISOString() ?? null,
      passwordWasGenerated: result.passwordWasGenerated,
      generatedPassword: result.generatedPassword,
      status: result.status,
      steps: result.steps,
    })}`);
    if (result.status === 'active') {
      console.log(`Next operator step (NOT automated): add ${result.secretEnvVar} (the centre database URL) to the deployment environment, otherwise the app tier cannot resolve this centre.`);
      if (result.passwordWasGenerated) {
        console.log('Save the generated database password above immediately — it is printed only once and stored nowhere.');
      }
      if (result.inviteToken) {
        console.log(`Send the invite token above to the first admin (${required(args, 'admin-email')}) to set their password via POST /api/v1/centres/activate-invite with { slug, token, password }.`);
      } else {
        console.log('A pending invite already exists for the first admin — if its link was lost, re-issue with: node dist/modules/tenants/space-provision.js invite --slug <slug> --email <email>');
      }
    }
    return;
  }
  if (command === 'invite') {
    const result = await manageCentreInvite({
      slug: required(args, 'slug'),
      email: required(args, 'email'),
      revokeOnly: args['revoke'] === true,
    });
    console.log(`INVITE_RESULT ${JSON.stringify({
      slug: result.slug,
      userId: result.userId,
      revokedCount: result.revokedCount,
      inviteToken: result.inviteToken,
      inviteExpiresAt: result.inviteExpiresAt?.toISOString() ?? null,
    })}`);
    if (result.inviteToken) {
      console.log(`Send the invite token above to ${required(args, 'email')} to set their password via POST /api/v1/centres/activate-invite with { slug, token, password }.`);
    }
    return;
  }
  if (command === 'install-roles') {
    const result = await installSpaceRoleBaseline({ slug: required(args, 'slug') });
    console.log(`ROLE_BASELINE_RESULT ${JSON.stringify({ slug: result.slug, outcome: result.outcome })}`);
    return;
  }
  console.error(USAGE);
  throw new Error(`Unknown command ${command ?? '(none)'}`);
}

main().catch((error: unknown) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
