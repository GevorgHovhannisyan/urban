import { useEffect } from 'react';
import { useApp } from '../context/AppContext';
import AccountLayout from '../components/account/AccountLayout';

export default function AccountPage() {
  const { user, navigate } = useApp();

  useEffect(() => {
    if (!user) navigate('login');
  }, [user]);

  if (!user) return null;
  return <AccountLayout />;
}
