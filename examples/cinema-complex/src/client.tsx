// src/client.tsx
import { StartClient } from '@tanstack/react-start/client';
import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { glaze } from '@glaze/cms';

glaze();

hydrateRoot(
	document,
	<StrictMode>
		<StartClient />
	</StrictMode>,
);
