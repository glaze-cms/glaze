import { useEffect, useState } from 'react';

/** The fetch lifecycle for the backend health probe. */
type Probe =
	| { status: 'loading' }
	| { status: 'ok'; data: unknown }
	| { status: 'error'; error: string };

/**
 * The hello-world admin: on mount it calls the Glaze backend (`GET /_health`, proxied to the Bun server
 * in dev) and renders the result — proving the frontend↔backend seam end to end.
 *
 * @returns The admin root element.
 */
export function App(): React.ReactElement {
	const [probe, setProbe] = useState<Probe>({ status: 'loading' });

	useEffect(() => {
		let cancelled = false;
		fetch('/_health')
			.then(async (response) => {
				if (!response.ok) throw new Error(`backend responded ${response.status}`);
				return response.json();
			})
			.then((data: unknown) => {
				if (!cancelled) setProbe({ status: 'ok', data });
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setProbe({
						status: 'error',
						error: error instanceof Error ? error.message : String(error),
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<main
			style={{
				fontFamily: 'system-ui, sans-serif',
				maxWidth: 640,
				margin: '4rem auto',
				padding: '0 1rem',
			}}
		>
			<h1>Glaze Admin</h1>
			<p>A hello-world admin talking to the Glaze backend.</p>
			{probe.status === 'loading' && <p>Contacting the backend…</p>}
			{probe.status === 'error' && (
				<p style={{ color: 'crimson' }}>
					Could not reach the backend: {probe.error}. Is the Glaze server running on{' '}
					<code>:4000</code>?
				</p>
			)}
			{probe.status === 'ok' && (
				<>
					<p>
						✅ Backend reachable — <code>GET /_health</code> returned:
					</p>
					<pre
						style={{ background: '#f4f4f5', padding: '1rem', borderRadius: 8, overflowX: 'auto' }}
					>
						{JSON.stringify(probe.data, null, 2)}
					</pre>
				</>
			)}
		</main>
	);
}
