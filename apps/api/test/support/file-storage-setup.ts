import { inject } from 'vitest';

process.env.FILE_STORAGE_DIR = inject('fileStorageDirectory');
