import type { ReactNode } from 'react';

import { DashboardLayoutSidebar } from './components/sidebar';

import './layout.css';

interface LayoutProps {
	children: ReactNode;
}

export function DashboardLayout({ children }: LayoutProps) {
	return (
		<div className="dashboard-container">
			<DashboardLayoutSidebar />
			<div>{children}</div>
		</div>
	);
}
