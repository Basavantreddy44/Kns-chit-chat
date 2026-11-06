import { useEffect, useRef, useState } from 'react';
import { getEmployee } from '../services/employeeService';

/**
 * Remembers who sent each message, where senders vary. History includes names; a
 * live message has only an id, so a sender seen for the first time is looked up once.
 */
export function useSenders(messages) {
  const [senders, setSenders] = useState({});
  const requested = useRef(new Set());

  useEffect(() => {
    const known = {};
    messages.forEach((message) => {
      if (message.sender_id && message.sender_full_name) {
        known[message.sender_id] = {
          id: message.sender_id,
          username: message.sender_username,
          full_name: message.sender_full_name,
          avatar_url: message.sender_avatar_url,
        };
      }
    });
    if (Object.keys(known).length) setSenders((current) => ({ ...current, ...known }));

    messages.forEach((message) => {
      const id = message.sender_id;
      if (!id || message.sender_full_name || known[id] || requested.current.has(id)) return;
      requested.current.add(id);
      getEmployee(id)
        .then((employee) => {
          if (employee) setSenders((current) => ({ ...current, [id]: employee }));
        })
        .catch(() => {
          requested.current.delete(id);
        });
    });
  }, [messages]);

  return (message) =>
    senders[message.sender_id] ?? {
      id: message.sender_id,
      full_name: message.sender_id ? 'Colleague' : 'Former employee',
    };
}
