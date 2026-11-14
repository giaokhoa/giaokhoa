import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type ModuleMetadata,
  type OnApplicationShutdown,
  type Provider,
  type Type,
} from '@nestjs/common';
import { createCentreKysely, type CentreDb } from '@giaokhoa/db';
import {
  createControlPlaneKysely,
  type ControlPlaneDb,
} from '@giaokhoa/db/control-plane';
import { createSystemBankKysely, type SystemBankDb } from '@giaokhoa/db/system-bank';
import type { Pool } from 'pg';
import { KYSELY_CENTRE, KYSELY_CONTROL_PLANE, KYSELY_SYSTEM_BANK } from './inject-kysely';

const KYSELY_INSTANCES = 'KYSELY_INSTANCES';

const KYSELY_MODULE_OPTIONS = 'KYSELY_MODULE_OPTIONS';

type DestroyableKysely = { destroy(): Promise<void> };

@Injectable()
class KyselyShutdownService implements OnApplicationShutdown {
  constructor(
    @Inject(KYSELY_INSTANCES)
    private readonly instances: readonly DestroyableKysely[],
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.instances.map((instance) => instance.destroy()));
  }
}

export interface KyselyModuleOptions {
  centre?: Pool;
  controlPlane?: Pool;
  systemBank?: Pool;
}

export interface KyselyModuleBorrowedOptions {
  centre?: CentreDb | null;
  controlPlane?: ControlPlaneDb | null;
  systemBank?: SystemBankDb | null;
}

export interface KyselyModuleAsyncOptions {
  imports?: ModuleMetadata['imports'];
  inject?: Array<string | symbol | Type<unknown>>;
  useFactory: (...args: never[]) => KyselyModuleBorrowedOptions | Promise<KyselyModuleBorrowedOptions>;
}

@Module({})
export class KyselyModule {
  static forRoot(options: KyselyModuleOptions): DynamicModule {
    const instances: DestroyableKysely[] = [];
    const providers: Provider[] = [];
    const exportsList: string[] = [];

    if (options.centre) {
      const centre: CentreDb = createCentreKysely(options.centre);
      instances.push(centre);
      providers.push({ provide: KYSELY_CENTRE, useValue: centre });
      exportsList.push(KYSELY_CENTRE);
    }
    if (options.controlPlane) {
      const controlPlane: ControlPlaneDb = createControlPlaneKysely(options.controlPlane);
      instances.push(controlPlane);
      providers.push({ provide: KYSELY_CONTROL_PLANE, useValue: controlPlane });
      exportsList.push(KYSELY_CONTROL_PLANE);
    }
    if (options.systemBank) {
      const systemBank: SystemBankDb = createSystemBankKysely(options.systemBank);
      instances.push(systemBank);
      providers.push({ provide: KYSELY_SYSTEM_BANK, useValue: systemBank });
      exportsList.push(KYSELY_SYSTEM_BANK);
    }

    providers.push({ provide: KYSELY_INSTANCES, useValue: instances }, KyselyShutdownService);

    return {
      module: KyselyModule,
      providers,
      exports: exportsList,
    };
  }

  static forRootAsync(options: KyselyModuleAsyncOptions): DynamicModule {
    return {
      module: KyselyModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: KYSELY_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        {
          provide: KYSELY_CENTRE,
          useFactory: (borrowed: KyselyModuleBorrowedOptions) => borrowed.centre ?? null,
          inject: [KYSELY_MODULE_OPTIONS],
        },
        {
          provide: KYSELY_CONTROL_PLANE,
          useFactory: (borrowed: KyselyModuleBorrowedOptions) => borrowed.controlPlane ?? null,
          inject: [KYSELY_MODULE_OPTIONS],
        },
        {
          provide: KYSELY_SYSTEM_BANK,
          useFactory: (borrowed: KyselyModuleBorrowedOptions) => borrowed.systemBank ?? null,
          inject: [KYSELY_MODULE_OPTIONS],
        },
      ],
      exports: [KYSELY_CENTRE, KYSELY_CONTROL_PLANE, KYSELY_SYSTEM_BANK],
    };
  }
}
