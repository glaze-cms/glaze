import Logo from '@assets/svg/logo.svg?react';

import type { ReactNode } from 'react';

import './auth-shell.css';

/**
 * The centered card the sign-in and sign-up screens share.
 *
 * @param props.title - The heading.
 * @param props.subtitle - Supporting copy under the heading.
 * @param props.children - The form.
 * @param props.footer - Cross-links, e.g. between sign-in and sign-up.
 * @returns The framed card.
 */
export function AuthShell({
	title,
	subtitle,
	children,
	footer,
}: {
	title: string;
	subtitle: string;
	children: ReactNode;
	footer?: ReactNode;
}) {
	return (
		<div className="auth-shell">
			<section className="auth-card">
				<Logo className="auth-logo" aria-hidden="true" />
				<h1 className="auth-title">{title}</h1>
				<p className="auth-subtitle">{subtitle}!</p>
				{children}
				{footer && <p className="auth-footer">{footer}</p>}
			</section>
		</div>
	);
}
