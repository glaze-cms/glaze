import type { ReactNode } from 'react';

/* Components */
import { DashboardLayoutSidebar } from './components/sidebar';

/* Styles */
import './layout.css';

interface LayoutProps {
	children: ReactNode;
	Header?: ReactNode;
}

export function DashboardLayout({ Header, children }: LayoutProps) {
	return (
		<div className="dashboard">
			<DashboardLayoutSidebar />
			<main className="main">
				{Header && <header className="header">{Header}</header>}
				<div className="content">{children}</div>
			</main>
		</div>
	);
}
