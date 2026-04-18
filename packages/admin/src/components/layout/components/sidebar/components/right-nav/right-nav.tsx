import { animated, useSpring } from '@react-spring/web';

/* Icons */
import PlusIcon from '@assets/svg/plus.svg?react';
import MultipleIcon from '@assets/svg/multiple.svg?react';
import SingleIcon from '@assets/svg/single.svg?react';

/* Styles */
import './right-nav.css';

/* Icons */
import PanelClose from '@assets/svg/panel-close.svg?react';
import MagnifyingGlass from '@assets/svg/magnifying-glass.svg?react';

/* Components */
import { Tooltip } from '@/components/tooltip';
import { Input } from '@/components/input';
import { Button } from '@/components/button';
import { Collapsible } from '@/components/collapsible';

interface RightNavProps {
	isOpen: boolean;
	onClose: () => void;
}

export function RightNav({ isOpen, onClose }: RightNavProps) {
	// Hooks
	const spring = useSpring({
		transform: isOpen ? 'translateX(0%)' : 'translateX(-120%)',
		config: isOpen
			? { tension: 288, friction: 32 }
			: { tension: 264, friction: 48, clamp: true },
	});

	return (
		<animated.nav className="right-nav" style={spring}>
			<div className="top">
				<Tooltip label="Close" shortcut="⌘B" side="bottom">
					<button
						type="button"
						className="close-button"
						aria-label="Close Panel"
						onClick={onClose}
					>
						<PanelClose aria-hidden="true" />
					</button>
				</Tooltip>
				<Input className="right-nav-input" LeftIcon={<MagnifyingGlass />} />
			</div>

			<div className="separator" aria-hidden="true" />

			<div className="bottom">
				<Button
					color="primary"
					LeftIcon={<PlusIcon />}
					size="small"
					isRounded={false}
				>
					New schema
				</Button>

				{/* Multiple */}
				<div>
					<Collapsible
						trigger={{
							Icon: <MultipleIcon />,
							title: 'Multiple',
						}}
						panel={{
							elements: [
								{
									label: 'Authors',
									onClick: () => {},
								},
								{
									label: 'Categories',
									onClick: () => {},
									isActive: true,
								},
								{
									label: 'Posts',
									onClick: () => {},
								},
							],
						}}
					/>

					{/* Single */}
					<Collapsible
						trigger={{
							Icon: <SingleIcon />,
							title: 'Single',
						}}
						panel={{
							elements: [
								{
									label: 'Home',
									onClick: () => {},
								},
								{
									label: 'Settings',
									isActive: true,
									onClick: () => {},
								},
								{
									label: 'Posts',
									onClick: () => {},
								},
							],
						}}
					/>
				</div>
			</div>
		</animated.nav>
	);
}
