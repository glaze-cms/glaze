import { Link } from '@tanstack/react-router';
import type { ComponentType, SVGProps } from 'react';

import Logo from '@assets/svg/logo.svg?react';

import './rail.css';

export type LeftRailItem = {
	label: string;
	to: string;
	icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export function LeftRail({
	topItems,
	bottomItems,
}: {
	topItems: LeftRailItem[];
	bottomItems: LeftRailItem[];
}) {
	return (
		<div className="rail">
			<Logo className="logo" />
			<h1 className="title">Glaze</h1>
			<div className="nav-items">
				<ul className="top">
					{topItems.map(({ label, to, icon: Icon }) => (
						<li key={`${to}-${label}`} className="item">
							<Link to={to} className="flex-col flex-center link">
								<Icon className="icon" />
								{label}
							</Link>
						</li>
					))}
				</ul>

				<ul className="bottom">
					{bottomItems.map(({ label, to, icon: Icon }) => (
						<li key={`${to}-${label}`} className="item">
							<Link to={to} className="flex-col flex-center link">
								<Icon className="icon" />
								{label}
							</Link>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
