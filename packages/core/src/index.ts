import type { GlazeInitialConfig } from './config';
import { createGlazeServer } from './server';

export function glaze(initialGlazeConfig: GlazeInitialConfig) {
	const server = createGlazeServer(initialGlazeConfig);

	return Object.assign(server, {
		start(port?: number) {
			const finalPort = port ?? initialGlazeConfig.port ?? 4000;
			server.listen(finalPort);
			return server;
		},
	});
}
