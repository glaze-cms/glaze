import Logo from '@assets/svg/logo.svg?react';
import { Link } from '@tanstack/react-router';

import type { LinkProps } from '@tanstack/react-router';
import type { ComponentType, ReactNode, SVGProps } from 'react';

import './rail.css';

/** A destination in the rail. `to` is checked against the real route tree, so a dead link cannot compile. */
export interface LeftRailItem {
	label: string;
	to: NonNullable<LinkProps['to']>;
	icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * The fixed left rail: brand, primary destinations, and a bottom slot for account actions.
 *
 * @param props.title - The product name shown under the logo.
 * @param props.items - Primary destinations. Every `to` must resolve in the route tree.
 * @param props.bottom - Rendered at the bottom of the rail, for actions rather than links.
 * @returns The rail.
 */
export function LeftRail({
	title,
	items,
	bottom,
}: {
	title: string;
	items: readonly LeftRailItem[];
	bottom?: ReactNode;
}) {
	return (
		<div className="rail">
			<Logo className="logo" aria-hidden="true" />
			<h1 className="title">{title}</h1>
			<div className="nav-items">
				<ul className="top">
					{items.map(({ label, to, icon: Icon }) => (
						<li key={label} className="item">
							<Link
								to={to}
								className="flex-col flex-center link"
								activeProps={{ className: 'active' }}
							>
								<Icon className="icon" aria-hidden="true" />
								{label}
							</Link>
						</li>
					))}
				</ul>

				{bottom && <div className="bottom">{bottom}</div>}
			</div>
		</div>
	);
}
