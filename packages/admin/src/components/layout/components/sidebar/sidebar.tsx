import { useCallback, useState } from 'react';

/* Styles */
import './sidebar.css';

/* Hooks */
import { useKeyCombo } from '@/lib/hooks/use-key-combo';

/* Icons */
import Block from '@assets/svg/block.svg?react';
import Notepad from '@assets/svg/notepad.svg?react';
import Nut from '@assets/svg/nut.svg?react';
import User from '@assets/svg/user.svg?react';

/* Components */
import { LeftRail, type LeftRailItem } from './components/left-rail';
import { DashboardLayoutSidebarTab as Tab } from './components/tab';
import { RightNav } from './components/right-nav';

const topItems: LeftRailItem[] = [
	{ label: 'Schemas', to: '/schemas', icon: Block },
	{ label: 'Content', to: '/content', icon: Notepad },
	{ label: 'Settings', to: '/settings', icon: Nut },
];

const bottomItems: LeftRailItem[] = [
	{ label: 'Profile', to: '/profile', icon: User },
];

export function DashboardLayoutSidebar() {
	const [isOpen, setIsOpen] = useState(false);

	// Handlers
	const handleTabOpen = () => {
		setIsOpen(true);
	};
	const handleTabClose = () => {
		setIsOpen(false);
	};
	const handleToggle = useCallback(() => {
		setIsOpen((v) => !v);
	}, []);

	// Hooks
	useKeyCombo({ key: 'b', meta: true, ctrl: true }, handleToggle);

	return (
		<nav className="sidebar">
			<RightNav isOpen={isOpen} onClose={handleTabClose} />
			<Tab isOpen={isOpen} onOpen={handleTabOpen} />
			<LeftRail topItems={topItems} bottomItems={bottomItems} />
		</nav>
	);
}
