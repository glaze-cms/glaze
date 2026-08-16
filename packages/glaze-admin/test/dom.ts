import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Component modules import their own stylesheet. The test runtime has no CSS handling, so resolve those
// imports to an empty module instead.
Bun.plugin({
	name: 'css-stub',
	setup(build) {
		build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
	},
});

// Must finish before anything imports Testing Library: `screen` binds to `document.body` at module
// evaluation, so a later registration leaves it bound to nothing. This is why the preload is split in
// two — a single module could not order an import after this call.
// A concrete origin is required: the admin builds request URLs relative to `window.location.origin`,
// and happy-dom otherwise starts at `about:blank`, which is not a valid base.
GlobalRegistrator.register({ url: 'http://localhost:4000/admin/' });
