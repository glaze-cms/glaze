import Block from '@assets/svg/block.svg?react';
import User from '@assets/svg/user.svg?react';
import { useCallback, useState } from 'react';

import { Tooltip } from '@/components/tooltip';
import { useTranslation } from '@/i18n';
import { useSignOut } from '@/lib/auth';
import { useKeyCombo } from '@/lib/hooks/use-key-combo.ts';

import { LeftRail, type LeftRailItem } from './components/left-rail';
import { RightNav } from './components/right-nav';
import { SidebarTab } from './components/tab';
import './sidebar.css';

/**
 * The sidebar: the fixed rail plus the panel that slides out from behind it, toggled with ⌘B / Ctrl+B.
 *
 * Rail destinations are limited to routes that exist. Add an entry here as each section lands, rather
 * than linking ahead to routes that would fail to typecheck.
 *
 * @returns The sidebar navigation landmark.
 */
export function Sidebar() {
	const { t } = useTranslation();
	const signOut = useSignOut();
	const [isOpen, setIsOpen] = useState(false);

	const handleOpen = useCallback(() => {
		setIsOpen(true);
	}, []);
	const handleClose = useCallback(() => {
		setIsOpen(false);
	}, []);
	const handleToggle = useCallback(() => {
		setIsOpen((open) => !open);
	}, []);

	useKeyCombo({ key: 'b', meta: true, ctrl: true }, handleToggle);

	const items: LeftRailItem[] = [{ label: t.nav.overview, to: '/', icon: Block }];

	return (
		<nav className="sidebar">
			<RightNav isOpen={isOpen} onClose={handleClose} />
			<SidebarTab isOpen={isOpen} onOpen={handleOpen} />
			<LeftRail
				title={t.app.name}
				items={items}
				bottom={
					<Tooltip label={t.nav.signOut}>
						<button
							type="button"
							className="sign-out flex-col flex-center"
							aria-label={t.nav.signOut}
							onClick={() => {
								void signOut();
							}}
						>
							<User className="icon" aria-hidden="true" />
						</button>
					</Tooltip>
				}
			/>
		</nav>
	);
}
