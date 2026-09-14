/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { Suspense }   from "react"
import FriendsClient  from "./FriendsClient"

export const metadata = { title: "เพื่อน — Slippy" }

export default function FriendsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">กำลังโหลด...</div>}>
      <FriendsClient />
    </Suspense>
  )
}
